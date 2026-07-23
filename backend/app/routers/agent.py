from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_capability, require_role
from app.models import Ad, AgentEvent, AgentRecommendation, AgentScrapeJob, GenerationJob, Notification, ScrapedSite, User
from app.schemas import (
    AdCreateIn, AgentEventIn, AgentEventOut, AgentRecommendationOut,
    AgentScrapeJobOut, AgentSettingsOut, AgentSettingsUpdateIn, NotificationOut, QuickStartIn,
    ScrapedSiteOut, ScrapedSiteLabelIn,
)
from app.services import agent_settings as agent_settings_svc
from app.services import credits as credit_svc
from app.worker import celery_app
from app.routers.ads import create_ad

router = APIRouter(prefix="/agent", tags=["agent"])


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
        skipped_years=ev.skipped_years or [], last_run_year=ev.last_run_year,
        next_run_date=_next_run_date(ev),
    )


# ── Quick Start ──────────────────────────────────────────────────────

@router.post("/quick-start", response_model=AgentScrapeJobOut)
async def start_quick_start(data: QuickStartIn, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
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
        select(AgentRecommendation).where(AgentRecommendation.company_id == user.company_id).order_by(AgentRecommendation.created_at.desc())
    )).all()
    return [
        AgentRecommendationOut(
            id=str(r.id), source_url=r.source_url, status=r.status, title=r.title, description=r.description,
            audience=r.audience or "",
            platforms=r.platforms or [], created_ad_id=str(r.created_ad_id) if r.created_ad_id else None, created_at=r.created_at,
        )
        for r in rows
    ]


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
        select(AgentRecommendation).where(AgentRecommendation.company_id == user.company_id).order_by(AgentRecommendation.created_at.desc())
    )).all()
    return [
        AgentRecommendationOut(
            id=str(r.id), source_url=r.source_url, status=r.status, title=r.title, description=r.description,
            audience=r.audience or "",
            platforms=r.platforms or [], created_ad_id=str(r.created_ad_id) if r.created_ad_id else None, created_at=r.created_at,
        )
        for r in rows
    ]


# ── Recurring Events ─────────────────────────────────────────────────

@router.get("/events", response_model=list[AgentEventOut])
async def list_events(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(AgentEvent).where(AgentEvent.company_id == user.company_id).order_by(AgentEvent.month, AgentEvent.day))).all()
    return [_event_out(e) for e in rows]


@router.post("/events", response_model=AgentEventOut)
async def create_event(data: AgentEventIn, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    try:
        date(2024, data.month, data.day)  # 2024 is a leap year — allows Feb 29 — just validating month/day is a real calendar date
    except ValueError:
        raise HTTPException(422, f"{data.month}/{data.day} isn't a valid date.")
    ev = AgentEvent(
        company_id=user.company_id, name=data.name, month=data.month, day=data.day, lead_days=data.lead_days,
        guidance=data.guidance, platforms=data.platforms, product_id=data.product_id, enabled=data.enabled,
        approval_mode=data.approval_mode or "draft_only",
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
    ev.name, ev.month, ev.day, ev.lead_days = data.name, data.month, data.day, data.lead_days
    ev.guidance, ev.platforms, ev.product_id, ev.enabled = data.guidance, data.platforms, data.product_id, data.enabled
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
    data: "QuickStartFromSiteIn",
    user: User = Depends(require_capability("create_ads")),
    db: AsyncSession = Depends(get_db),
):
    """Generate recommendations from a previously saved site scrape —
    no re-crawl, uses the stored content directly."""
    import uuid as _uuid
    from app.schemas import QuickStartFromSiteIn as _In
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
