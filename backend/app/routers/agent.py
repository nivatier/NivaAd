from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_capability, require_role
from app.models import Ad, AgentEvent, AgentRecommendation, AgentScrapeJob, CreditLedger, GenerationJob, Notification, ScrapedSite, User
from app.schemas import (
    AdCreateIn, AgentEventIn, AgentEventOut, AgentRecommendationOut,
    AgentScrapeJobOut, AgentSettingsOut, AgentSettingsUpdateIn, NotificationOut, QuickStartIn,
    QuickStartFromSiteIn, RecommendationPatchIn, RecommendationRegenerateIn,
    ScrapedSiteOut, ScrapedSiteLabelIn,
)
from app.services import agent_settings as agent_settings_svc
from app.services import credits as credit_svc
from app.worker import celery_app
from app.routers.ads import create_ad

router = APIRouter(prefix="/agent", tags=["agent"])

IDEA_GEN_COST = 0.25  # credits charged per idea-generation call (quick-start, quick-spark, regenerate)


async def _charge_idea_credits(db: AsyncSession, user: User, reason: str) -> None:
    """Deduct IDEA_GEN_COST credits, raising 402 if balance is insufficient."""
    bal = await credit_svc.balance(db, user.company_id)
    if bal < IDEA_GEN_COST:
        raise HTTPException(402, f"Not enough credits: generating ideas costs {IDEA_GEN_COST} credit, you have {bal:.2f}. Top up or upgrade your plan.")
    db.add(CreditLedger(company_id=user.company_id, delta=-IDEA_GEN_COST, reason=reason))
    await db.commit()



def _next_run_date(ev: AgentEvent) -> str | None:
    today = date.today()
    for year in (today.year, today.year + 1):
        try:
            trigger = date(year, ev.month, ev.day)
        except ValueError:
            return None  # malformed month/day combo (shouldn't happen — validated on create)
        if ev.last_run_year == year or year in (ev.skipped_years or []):
            continue
        if trigger >= today or year == today.year + 1:
            return trigger.isoformat()
    return None


def _event_out(ev: AgentEvent) -> AgentEventOut:
    return AgentEventOut(
        id=str(ev.id), name=ev.name, month=ev.month, day=ev.day, lead_days=ev.lead_days,
        guidance=ev.guidance, platforms=ev.platforms or [], product_id=str(ev.product_id) if ev.product_id else None,
        enabled=ev.enabled, approval_mode=ev.approval_mode or "draft_only",
        post_hour=ev.post_hour if ev.post_hour is not None else 10,
        post_minute=ev.post_minute if ev.post_minute is not None else 0,
        wish_tone=ev.wish_tone or "warm",
        visual_style=ev.visual_style or "festive",
        reference_image_url=ev.reference_image_url,
        skipped_years=ev.skipped_years or [], last_run_year=ev.last_run_year,
        next_run_date=_next_run_date(ev),
    )


# ── Quick Start ──────────────────────────────────────────────────────

@router.post("/quick-start", response_model=AgentScrapeJobOut)
async def start_quick_start(data: QuickStartIn, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    await _charge_idea_credits(db, user, "idea_gen_website_spark")
    job = AgentScrapeJob(company_id=user.company_id, url=data.url, count=data.count, focus=data.focus or None, status="queued")
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()
    celery_app.send_task("app.generate_quick_start_recommendations", args=[str(job_id)])
    return AgentScrapeJobOut.model_validate(job)


@router.get("/quick-start/{job_id}", response_model=AgentScrapeJobOut)
async def get_quick_start_job(job_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    job = await db.get(AgentScrapeJob, job_id)
    if job is None or job.company_id != user.company_id:
        raise HTTPException(404, "No such job")
    return AgentScrapeJobOut.model_validate(job)


@router.get("/recommendations", response_model=list[AgentRecommendationOut])
async def list_recommendations(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(
        select(AgentRecommendation)
        .where(AgentRecommendation.company_id == user.company_id, AgentRecommendation.status == "pending")
        .order_by(AgentRecommendation.created_at.desc())
    )).all()
    return [_rec_out(r) for r in rows]


@router.post("/recommendations/{rec_id}/create")
async def create_ad_from_recommendation(rec_id: str, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    """Turns one pending recommendation into a real ad — reuses the
    exact same ad-creation endpoint logic Create Ad itself calls
    (POST /ads), just invoked directly with a constructed payload
    instead of going through another HTTP round-trip. Text + image
    only, same simplification as recurring event ads — Quick Start
    recommends the ANGLE, not every Create Ad option."""
    rec = await db.get(AgentRecommendation, rec_id)
    if rec is None or rec.company_id != user.company_id:
        raise HTTPException(404, "No such recommendation")
    if rec.status != "pending":
        raise HTTPException(409, f"This recommendation is already {rec.status}.")

    settings_ = await agent_settings_svc.get_agent_settings(db, user.company_id)
    if settings_.get("credit_cap_mode") == "monthly_budget":
        month_start = datetime(datetime.utcnow().year, datetime.utcnow().month, 1)
        spent = await db.scalar(
            select(func.coalesce(func.sum(GenerationJob.credits_cost), 0))
            .select_from(GenerationJob).join(Ad, Ad.id == GenerationJob.ad_id)
            .where(Ad.company_id == user.company_id, Ad.agent_source.isnot(None), GenerationJob.created_at >= month_start)
        ) or 0
        budget = settings_.get("monthly_credit_budget", 200)
        if spent >= budget:
            raise HTTPException(402, f"This month's Agent Niva credit budget ({budget}) has been reached. Ask your developer to raise it, or create this ad manually from Create Ad instead.")

    # Resolve the first enabled text and image models — create_ad requires
    # explicit model IDs (same validation Create Ad's own form enforces).
    # Agent-generated ads always use the platform's first enabled option.
    available = await credit_svc.get_available_models(db)
    text_models = [m for m in available.get("text", []) if m.get("enabled", True)]
    image_models = [m for m in available.get("image", []) if m.get("enabled", True)]
    if not text_models:
        raise HTTPException(422, "No enabled text model configured — ask your developer to add one under Developer > Models.")
    if not image_models:
        raise HTTPException(422, "No enabled image model configured — ask your developer to add one under Developer > Models.")

    payload = AdCreateIn(
        product_name=rec.title, description=rec.description or rec.title,
        platforms=rec.platforms or ["facebook", "instagram"],
        outputs={"text": True, "image": True, "video": False},
        text_model_id=text_models[0]["id"],
        image_model_id=image_models[0]["id"],
    )
    result = await create_ad(data=payload, user=user, db=db)
    ad_id = result.ad_id
    ad = await db.get(Ad, ad_id)
    if ad:
        ad.agent_source = "quick_start"
    rec.status = "created"
    rec.created_ad_id = ad_id
    await db.commit()
    return {"ad_id": str(ad_id)}


@router.post("/recommendations/{rec_id}/dismiss", response_model=list[AgentRecommendationOut])
async def dismiss_recommendation(rec_id: str, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    rec = await db.get(AgentRecommendation, rec_id)
    if rec is None or rec.company_id != user.company_id:
        raise HTTPException(404, "No such recommendation")
    rec.status = "dismissed"
    await db.commit()
    rows = (await db.scalars(
        select(AgentRecommendation)
        .where(AgentRecommendation.company_id == user.company_id, AgentRecommendation.status == "pending")
        .order_by(AgentRecommendation.created_at.desc())
    )).all()
    return [_rec_out(r) for r in rows]


def _rec_out(r: AgentRecommendation) -> AgentRecommendationOut:
    return AgentRecommendationOut(
        id=str(r.id), source_url=r.source_url, status=r.status,
        title=r.title, description=r.description, audience=r.audience or "",
        platforms=r.platforms or [], voice=r.voice, reference_style=r.reference_style,
        image_prompt=r.image_prompt or None,
        product_id=str(r.product_id) if r.product_id else None,
        created_ad_id=str(r.created_ad_id) if r.created_ad_id else None,
        created_at=r.created_at,
    )


@router.patch("/recommendations/{rec_id}", response_model=AgentRecommendationOut)
async def patch_recommendation(
    rec_id: str, data: RecommendationPatchIn,
    user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db),
):
    """Inline-edit title, description, platforms, product, voice or reference_style on a card."""
    rec = await db.get(AgentRecommendation, rec_id)
    if rec is None or rec.company_id != user.company_id:
        raise HTTPException(404, "No such recommendation")
    if data.title is not None:
        rec.title = data.title[:200]
    if data.description is not None:
        rec.description = data.description
    if data.platforms is not None:
        rec.platforms = data.platforms
    if data.product_id is not None:
        rec.product_id = data.product_id
    if data.voice is not None:
        rec.voice = data.voice
    if data.reference_style is not None:
        rec.reference_style = data.reference_style
    await db.commit()
    await db.refresh(rec)
    return _rec_out(rec)


@router.post("/recommendations/{rec_id}/save", response_model=AgentRecommendationOut)
async def save_recommendation(
    rec_id: str,
    user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db),
):
    """Move a pending recommendation to 'saved' so it appears in the Saved Ideas panel."""
    rec = await db.get(AgentRecommendation, rec_id)
    if rec is None or rec.company_id != user.company_id:
        raise HTTPException(404, "No such recommendation")
    if rec.status != "pending":
        raise HTTPException(409, f"Recommendation is already {rec.status}")
    rec.status = "saved"
    await db.commit()
    await db.refresh(rec)
    return _rec_out(rec)


@router.post("/recommendations/{rec_id}/unsave", response_model=AgentRecommendationOut)
async def unsave_recommendation(
    rec_id: str,
    user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db),
):
    """Move a saved recommendation back to pending."""
    rec = await db.get(AgentRecommendation, rec_id)
    if rec is None or rec.company_id != user.company_id:
        raise HTTPException(404, "No such recommendation")
    if rec.status != "saved":
        raise HTTPException(409, "Recommendation is not saved")
    rec.status = "pending"
    await db.commit()
    await db.refresh(rec)
    return _rec_out(rec)


@router.get("/recommendations/saved", response_model=list[AgentRecommendationOut])
async def list_saved_recommendations(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    """Returns all saved recommendations for the right-panel Saved Ideas section."""
    rows = (await db.scalars(
        select(AgentRecommendation)
        .where(AgentRecommendation.company_id == user.company_id, AgentRecommendation.status == "saved")
        .order_by(AgentRecommendation.created_at.desc())
    )).all()
    return [_rec_out(r) for r in rows]


@router.post("/recommendations/{rec_id}/regenerate", response_model=AgentRecommendationOut)
async def regenerate_recommendation(
    rec_id: str, data: RecommendationRegenerateIn,
    user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db),
):
    """Rewrites the description of one recommendation using the chosen voice and reference style."""
    import re
    from app.services import text_gen
    from app.services.credits import get_available_models

    await _charge_idea_credits(db, user, "idea_gen_rewrite")
    rec = await db.get(AgentRecommendation, rec_id)
    if rec is None or rec.company_id != user.company_id:
        raise HTTPException(404, "No such recommendation")

    # Derive a clean domain label from the source URL for courtesy lines
    domain_raw = re.sub(r"https?://(www\.)?", "", rec.source_url).split("/")[0]
    domain_label = domain_raw.capitalize()

    voice_instructions = {
        "we":      "Use 'We' and 'Our' to refer to the company throughout.",
        "i":       "Use 'I' and 'My' — write from a founder/personal perspective.",
        "neutral": "Use third-person language — refer to 'the brand' or 'the company'.",
        "you":     "Address the reader directly using 'You' and 'Your'.",
    }
    reference_instructions = {
        "none":  "",
        "start": f"Begin the description with 'Courtesy {domain_label} — ' before the ad idea.",
        "end":   f"End the description with ' — Courtesy {domain_label}'.",
    }

    voice_instr = voice_instructions.get(data.voice, voice_instructions["neutral"])
    ref_instr = reference_instructions.get(data.reference_style, "")

    prompt = (
        f"Rewrite the following social media ad idea description. "
        f"{voice_instr} "
        f"{ref_instr} "
        f"Keep the same core idea and audience. Output ONLY the rewritten description — "
        f"no preamble, no labels, no quotes.\n\n"
        f"Ad idea title: {rec.title}\n"
        f"Current description: {rec.description}"
    )

    available = await get_available_models(db)
    text_models = [m for m in available.get("text", []) if m.get("enabled", True)]
    if not text_models:
        raise HTTPException(422, "No enabled text model configured.")

    # Prompt returns plain prose — use httpx.AsyncClient to avoid _extract_json crash
    from app.services.text_gen import CHAT_URL
    from app.config import settings as _settings
    import httpx as _httpx

    async with _httpx.AsyncClient(timeout=60) as _client:
        ai_resp = await _client.post(
            CHAT_URL,
            headers={"Authorization": f"Bearer {_settings.OPENROUTER_API_KEY}", "Content-Type": "application/json"},
            json={"model": text_models[0]["model"], "max_tokens": 400,
                  "messages": [{"role": "user", "content": prompt}]},
        )
    if ai_resp.status_code >= 400:
        raise HTTPException(502, f"AI error rewriting description: {ai_resp.status_code}")
    new_desc = (ai_resp.json().get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
    if not new_desc:
        new_desc = rec.description
    rec.description = new_desc
    rec.voice = data.voice
    rec.reference_style = data.reference_style
    await db.commit()
    await db.refresh(rec)
    return _rec_out(rec)


@router.post("/recommendations/{rec_id}/image-prompt", response_model=AgentRecommendationOut)
async def generate_image_prompt(
    rec_id: str,
    user: User = Depends(require_capability("create_ads")),
    db: AsyncSession = Depends(get_db),
):
    """Generate (or regenerate) an image prompt for an existing recommendation
    without re-running the full website scrape. Charges 0.25 credits."""
    from app.services import text_gen
    from app.services.credits import get_available_models
    from app.services.text_gen import CHAT_URL
    from app.config import settings as _settings
    import httpx as _httpx

    await _charge_idea_credits(db, user, "idea_gen_image_prompt")
    rec = await db.get(AgentRecommendation, rec_id)
    if rec is None or rec.company_id != user.company_id:
        raise HTTPException(404, "No such recommendation")

    available = await get_available_models(db)
    text_models = [m for m in available.get("text", []) if m.get("enabled", True)]
    if not text_models:
        raise HTTPException(422, "No enabled text model configured.")

    prompt = (
        f"You are a visual director creating image generation prompts for social media ads.\n\n"
        f"Ad idea title: {rec.title}\n"
        f"Ad description: {rec.description}\n"
        f"Target audience: {rec.audience or 'general audience'}\n\n"
        f"Write a single detailed image generation prompt for this ad — a specific, vivid scene "
        f"description suitable for an AI image model. Include setting, mood, lighting, and style. "
        f"Do NOT include any text, words, logos, or people reading. "
        f"Output ONLY the image prompt — no preamble, no labels, no quotes."
    )

    async with _httpx.AsyncClient(timeout=60) as _client:
        ai_resp = await _client.post(
            CHAT_URL,
            headers={"Authorization": f"Bearer {_settings.OPENROUTER_API_KEY}", "Content-Type": "application/json"},
            json={"model": text_models[0]["model"], "max_tokens": 200,
                  "messages": [{"role": "user", "content": prompt}]},
        )
    if ai_resp.status_code >= 400:
        raise HTTPException(502, f"AI error: {ai_resp.status_code}")
    image_prompt = (ai_resp.json().get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
    if not image_prompt:
        raise HTTPException(500, "No image prompt returned — try again.")

    rec.image_prompt = image_prompt
    await db.commit()
    await db.refresh(rec)
    return _rec_out(rec)


# ── Recurring Events ─────────────────────────────────────────────────

@router.get("/events", response_model=list[AgentEventOut])
async def list_events(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(AgentEvent).where(AgentEvent.company_id == user.company_id).order_by(AgentEvent.month, AgentEvent.day))).all()
    return [_event_out(e) for e in rows]


@router.post("/events/upload-reference")
async def upload_event_reference_image(
    data: dict,
    user: User = Depends(require_capability("create_ads")),
):
    """Accepts a base64 data URL, uploads it to R2 under event-refs/, returns the public URL.
    Called by the frontend when the user picks a custom reference photo in the event modal."""
    from app.services.storage import upload_data_url
    image_data = data.get("image")
    if not image_data or not image_data.startswith("data:"):
        raise HTTPException(422, "image must be a base64 data URL")
    url = upload_data_url(image_data, prefix="event-refs")
    return {"url": url}


@router.post("/events", response_model=AgentEventOut)
async def create_event(data: AgentEventIn, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    try:
        date(2024, data.month, data.day)  # 2024 is a leap year — allows Feb 29 — just validating month/day is a real calendar date
    except ValueError:
        raise HTTPException(422, f"{data.month}/{data.day} isn't a valid date.")
    # If a fresh base64 image was uploaded, store it now
    from app.services.storage import upload_data_url
    ref_url = data.reference_image_url
    if data.reference_image:
        ref_url = upload_data_url(data.reference_image, prefix="event-refs")
    ev = AgentEvent(
        company_id=user.company_id, name=data.name, month=data.month, day=data.day, lead_days=data.lead_days,
        guidance=data.guidance, platforms=data.platforms, product_id=data.product_id, enabled=data.enabled,
        approval_mode=data.approval_mode or "draft_only",
        post_hour=data.post_hour, post_minute=data.post_minute,
        wish_tone=data.wish_tone, visual_style=data.visual_style,
        reference_image_url=ref_url,
    )
    db.add(ev)
    await db.commit()
    return _event_out(ev)


@router.put("/events/{event_id}", response_model=AgentEventOut)
async def update_event(event_id: str, data: AgentEventIn, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    ev = await db.get(AgentEvent, event_id)
    if ev is None or ev.company_id != user.company_id:
        raise HTTPException(404, "No such event")
    try:
        date(2024, data.month, data.day)
    except ValueError:
        raise HTTPException(422, f"{data.month}/{data.day} isn't a valid date.")
    from app.services.storage import upload_data_url
    ref_url = data.reference_image_url
    if data.reference_image:
        ref_url = upload_data_url(data.reference_image, prefix="event-refs")
    ev.name, ev.month, ev.day, ev.lead_days = data.name, data.month, data.day, data.lead_days
    ev.guidance, ev.platforms, ev.product_id, ev.enabled = data.guidance, data.platforms, data.product_id, data.enabled
    ev.post_hour, ev.post_minute = data.post_hour, data.post_minute
    ev.wish_tone, ev.visual_style = data.wish_tone, data.visual_style
    ev.reference_image_url = ref_url
    if data.approval_mode:
        ev.approval_mode = data.approval_mode
    await db.commit()
    return _event_out(ev)


@router.post("/events/{event_id}/skip-year", response_model=AgentEventOut)
async def skip_event_year(event_id: str, year: int, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    """Pauses just ONE year's occurrence without touching the recurring
    definition — e.g. "not running the Christmas ad this year"."""
    ev = await db.get(AgentEvent, event_id)
    if ev is None or ev.company_id != user.company_id:
        raise HTTPException(404, "No such event")
    years = set(ev.skipped_years or [])
    years.add(year)
    ev.skipped_years = sorted(years)
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(ev, "skipped_years")
    await db.commit()
    return _event_out(ev)


@router.post("/events/{event_id}/unskip-year", response_model=AgentEventOut)
async def unskip_event_year(event_id: str, year: int, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    ev = await db.get(AgentEvent, event_id)
    if ev is None or ev.company_id != user.company_id:
        raise HTTPException(404, "No such event")
    ev.skipped_years = [y for y in (ev.skipped_years or []) if y != year]
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(ev, "skipped_years")
    await db.commit()
    return _event_out(ev)


@router.delete("/events/{event_id}", response_model=list[AgentEventOut])
async def delete_event(event_id: str, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    ev = await db.get(AgentEvent, event_id)
    if ev is None or ev.company_id != user.company_id:
        raise HTTPException(404, "No such event")
    await db.delete(ev)
    await db.commit()
    rows = (await db.scalars(select(AgentEvent).where(AgentEvent.company_id == user.company_id).order_by(AgentEvent.month, AgentEvent.day))).all()
    return [_event_out(e) for e in rows]


# ── Agent Niva settings (company-admin only) ──────────────────────────

@router.get("/settings", response_model=AgentSettingsOut)
async def get_company_agent_settings(user: User = Depends(require_role("admin")), db: AsyncSession = Depends(get_db)):
    """Returns this company's Agent Niva policy — Quick Start mode,
    event approval mode, and credit spend cap. Falls back to platform
    defaults for any key the company hasn't explicitly set yet."""
    return AgentSettingsOut(**await agent_settings_svc.get_agent_settings(db, user.company_id))


@router.put("/settings", response_model=AgentSettingsOut)
async def update_company_agent_settings(data: AgentSettingsUpdateIn, user: User = Depends(require_role("admin")), db: AsyncSession = Depends(get_db)):
    """Updates this company's Agent Niva policy. Admin-only — editors
    and posters can use Agent Niva but can't change how it behaves."""
    updated = await agent_settings_svc.update_agent_settings(db, user.company_id, data.model_dump())
    return AgentSettingsOut(**updated)


# ── Notifications ─────────────────────────────────────────────────────

@router.get("/notifications", response_model=list[NotificationOut])
async def list_notifications(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Returns all undismissed notifications for this company — scoped
    company-wide so every admin sees the same pool. Ordered newest first."""
    rows = (await db.scalars(
        select(Notification)
        .where(Notification.company_id == user.company_id)
        .order_by(Notification.created_at.desc())
        .limit(50)
    )).all()
    user_id = str(user.id)
    return [
        NotificationOut(
            id=str(n.id), type=n.type, title=n.title, body=n.body,
            action_url=n.action_url, created_at=n.created_at,
        )
        for n in rows
        if user_id not in (n.dismissed_by or [])
    ]


@router.post("/notifications/{notification_id}/dismiss", response_model=list[NotificationOut])
async def dismiss_notification(notification_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Dismisses a notification for this user only — other company
    members still see it until they dismiss it themselves."""
    n = await db.get(Notification, notification_id)
    if n is None or n.company_id != user.company_id:
        raise HTTPException(404, "No such notification")
    dismissed = list(n.dismissed_by or [])
    user_id = str(user.id)
    if user_id not in dismissed:
        dismissed.append(user_id)
        n.dismissed_by = dismissed
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(n, "dismissed_by")
        await db.commit()
    # Return remaining undismissed notifications
    rows = (await db.scalars(
        select(Notification)
        .where(Notification.company_id == user.company_id)
        .order_by(Notification.created_at.desc())
        .limit(50)
    )).all()
    return [
        NotificationOut(
            id=str(r.id), type=r.type, title=r.title, body=r.body,
            action_url=r.action_url, created_at=r.created_at,
        )
        for r in rows
        if user_id not in (r.dismissed_by or [])
    ]


@router.post("/notifications/dismiss-all", response_model=list[NotificationOut])
async def dismiss_all_notifications(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Dismisses all notifications for this user."""
    rows = (await db.scalars(
        select(Notification)
        .where(Notification.company_id == user.company_id)
        .order_by(Notification.created_at.desc())
        .limit(50)
    )).all()
    user_id = str(user.id)
    for n in rows:
        if user_id not in (n.dismissed_by or []):
            dismissed = list(n.dismissed_by or [])
            dismissed.append(user_id)
            n.dismissed_by = dismissed
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(n, "dismissed_by")
    await db.commit()
    return []


# ── Scraped Sites ─────────────────────────────────────────────────────────────

@router.get("/scraped-sites", response_model=list[ScrapedSiteOut])
async def list_scraped_sites(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """All cached site scrapes for this company, newest first."""
    rows = (await db.scalars(
        select(ScrapedSite)
        .where(ScrapedSite.company_id == user.company_id)
        .order_by(ScrapedSite.scraped_at.desc())
    )).all()
    return [ScrapedSiteOut.model_validate(r) for r in rows]


@router.post("/scraped-sites", response_model=ScrapedSiteOut)
async def save_scraped_site(
    data: ScrapedSiteLabelIn,
    job_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save (or update) the scraped content from a completed quick-start
    job as a reusable ScrapedSite for this company.
    If a row for the same URL already exists it is updated in-place;
    otherwise a new one is created. The job must belong to this company
    and must be in status 'ready'."""
    from app.models import AgentScrapeJob as _Job
    job = await db.get(_Job, job_id)
    if not job or job.company_id != user.company_id:
        raise HTTPException(404, "Job not found")
    if job.status != "ready":
        raise HTTPException(400, "Job must be completed (status=ready) before saving")

    # Retrieve the scraped text — stored on the job row by the task
    if not job.content:
        raise HTTPException(400, "No scraped content found on this job")

    # Upsert: update existing row for same URL, or create new
    existing = await db.scalar(
        select(ScrapedSite).where(
            ScrapedSite.company_id == user.company_id,
            ScrapedSite.url == job.url,
        )
    )
    from datetime import datetime as _dt
    if existing:
        existing.label = data.label
        existing.content = job.content
        existing.scraped_at = _dt.utcnow()
        await db.commit()
        await db.refresh(existing)
        return ScrapedSiteOut.model_validate(existing)
    else:
        site = ScrapedSite(
            company_id=user.company_id,
            url=job.url,
            label=data.label,
            content=job.content,
            scraped_at=_dt.utcnow(),
        )
        db.add(site)
        await db.commit()
        await db.refresh(site)
        return ScrapedSiteOut.model_validate(site)


@router.patch("/scraped-sites/{site_id}", response_model=ScrapedSiteOut)
async def rename_scraped_site(
    site_id: str,
    data: ScrapedSiteLabelIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rename a saved site."""
    import uuid as _uuid
    site = await db.get(ScrapedSite, _uuid.UUID(site_id))
    if not site or site.company_id != user.company_id:
        raise HTTPException(404, "Site not found")
    site.label = data.label
    await db.commit()
    await db.refresh(site)
    return ScrapedSiteOut.model_validate(site)


@router.delete("/scraped-sites/{site_id}", status_code=204)
async def delete_scraped_site(
    site_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a saved site scrape."""
    import uuid as _uuid
    site = await db.get(ScrapedSite, _uuid.UUID(site_id))
    if not site or site.company_id != user.company_id:
        raise HTTPException(404, "Site not found")
    await db.delete(site)
    await db.commit()


@router.post("/quick-start/from-site/{site_id}", response_model=AgentScrapeJobOut)
async def quick_start_from_saved_site(
    site_id: str,
    data: QuickStartFromSiteIn,
    user: User = Depends(require_capability("create_ads")),
    db: AsyncSession = Depends(get_db),
):
    """Generate recommendations from a previously saved site scrape —
    no re-crawl, uses the stored content directly."""
    await _charge_idea_credits(db, user, "idea_gen_website_spark")
    import uuid as _uuid
    site = await db.get(ScrapedSite, _uuid.UUID(site_id))
    if not site or site.company_id != user.company_id:
        raise HTTPException(404, "Saved site not found")
    job = AgentScrapeJob(
        company_id=user.company_id,
        url=site.url,
        count=data.count,
        focus=data.focus or None,
        status="queued",
        content=site.content,  # pre-filled — task will skip scraping
    )
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()
    from app.worker import celery_app as _celery
    _celery.send_task("app.generate_quick_start_recommendations", args=[str(job_id)])
    return AgentScrapeJobOut.model_validate(job)


@router.post("/quick-spark")
async def quick_spark(
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate ad draft concepts from a user's idea via OpenRouter.
    Replaced the original browser→Anthropic direct call so all LLM
    traffic goes through OpenRouter (same key, same billing)."""
    import json
    import httpx
    from app.config import settings
    from app.services.text_gen import CHAT_URL

    idea  = str(body.get("idea", "")).strip()
    count = min(int(body.get("count", 4)), 6)
    if not idea:
        raise HTTPException(422, "idea is required")
    await _charge_idea_credits(db, user, "idea_gen_quick_spark")

    system_prompt = f"""You are an expert marketing strategist. Given a user's ad idea, generate {count} distinct, creative ad draft concepts. Each should have a different angle, tone, or target audience slice.

Return ONLY a JSON array — no markdown, no prose, no backticks:
[
  {{
    "id": "1",
    "title": "Short punchy ad concept title (max 8 words)",
    "description": "What this ad communicates and why it works (2-3 sentences)",
    "audience": "Who this speaks to (1 sentence)",
    "suggested_tone": "Professional | Fun | Luxury | Minimal | Bold | Emotional",
    "goal": "Drive sales | Product launch | Brand awareness | Get signups"
  }}
]
Make each concept meaningfully different. Be specific and actionable."""

    resp = httpx.post(
        CHAT_URL,
        headers={
            "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": "anthropic/claude-sonnet-4-5",
            "max_tokens": 1200,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": f"My ad idea: {idea}"},
            ],
        },
        timeout=60,
    )
    if resp.status_code >= 400:
        raise HTTPException(502, f"OpenRouter error: {resp.text[:300]}")

    raw = (resp.json().get("choices") or [{}])[0].get("message", {}).get("content", "[]")
    try:
        drafts = json.loads(raw.replace("```json", "").replace("```", "").strip())
    except Exception:
        raise HTTPException(500, "Could not parse AI response — try again")

    return {"drafts": drafts}
