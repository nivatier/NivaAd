import asyncio
import uuid
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_capability
from app.models import Ad, AuditLog, BrandKit, Campaign, CreditLedger, GenerationJob, ScheduledPost, User
from app.schemas import (
    AdCreatedOut, CampaignCreateIn, CampaignImageIn, CampaignListOut, CampaignOut, PhaseScheduleIn,
)
from app.services import credits as credit_svc
from app.services import pricing as pricing_svc
from app.services import retention as retention_svc
from app.services import text_gen
from app.services.guardrails import check_text
from app.services.storage import upload_data_url
from app.worker import celery_app

router = APIRouter(prefix="/campaigns", tags=["campaigns"])

CAMPAIGN_COST = 2
PHASES = ("teaser", "launch", "followup")


async def _call_claude_campaign(db: AsyncSession, name: str, brief: str) -> dict:
    """Generates all 3 phase captions in one call — campaigns don't have
    a per-phase text model picker (that's a Create Ad wizard feature),
    so this just uses whichever text model is first in the developer's
    list, same "sensible default" pattern used for campaigns' image
    model before it got a real picker. Campaign text generation stays
    free/bundled (not charged separately) — only routed through
    OpenRouter now instead of a direct Anthropic call, for the same
    reason every other text generation moved: one unified account to
    manage and monitor, no per-token markup for Claude models."""
    prompt = (
        f'Write a 3-phase product launch social media campaign for: "{name} — {brief}". '
        "Respond ONLY with raw JSON, no markdown fences, shaped exactly as: "
        '{"teaser":{"caption":"..."},"launch":{"caption":"..."},"followup":{"caption":"..."}}. '
        "The teaser builds curiosity without revealing everything. The launch announces with a clear call "
        "to action. The follow-up adds social proof or urgency (e.g. referencing early response, limited time)."
    )
    models = await credit_svc.get_available_models(db)
    text_options = [m for m in models.get("text", []) if m.get("enabled", True)]
    text_model = text_options[0]["model"] if text_options else "google/gemini-2.5-flash"
    # text_gen.generate_text is a sync function (built to match
    # generate_image/generate_video's style for use inside Celery
    # tasks) — this call site is a FastAPI async endpoint though, so it
    # needs to run off-thread rather than block the event loop for the
    # duration of the HTTP call, unlike the old direct httpx.AsyncClient
    # call it's replacing.
    return await asyncio.to_thread(text_gen.generate_text, prompt, text_model)


def _fallback_phases(name: str) -> dict:
    return {
        "teaser": {"caption": f"Something new is coming… 👀 Stay tuned for {name}."},
        "launch": {"caption": f"It's here — {name} is live! Be among the first to try it."},
        "followup": {"caption": f"The response to {name} has been incredible. Don't miss out."},
    }


async def _create_phase_ad(
    db: AsyncSession, user: User, campaign: Campaign, phase: str, caption: str,
    platforms: list[str], generate_image: bool,
    env: str | None = None, image_scene: str | None = None,
    product_image: str | None = None, use_brand_logo: bool = False,
    image_model_id: str | None = None,
    generate_video: bool = False, video_model_id: str | None = None,
    video_shots: list | None = None, video_frame_image: str | None = None,
    video_frame_image_url: str | None = None, video_resolution: str | None = None,
    video_prompt_override: str | None = None,
    video_mode: str = "single_reference", video_end_frame_image: str | None = None,
    video_end_frame_image_url: str | None = None, refine_video_prompt: bool = False,
    refine_video_frame: bool = False,
) -> tuple[Ad, int, uuid.UUID | None]:
    """Creates a real ad for one campaign phase. Copy is free (it's the
    phase's own caption, no extra Claude call) — cost is image and/or
    video only. Supports the same per-phase photo upload / scene prompt /
    brand kit / model choice / video generation as Create Ad.

    IMPORTANT: does NOT dispatch the Celery task itself — only returns the
    created job's id (if any). Dispatching must happen strictly AFTER the
    caller's transaction commits, or the worker (a separate DB connection)
    can query for the job before it's actually visible outside this
    transaction and find nothing — a real bug this fixes."""
    cost = 0
    image_model = None
    if generate_image:
        models = await credit_svc.get_available_models(db)
        markup = await pricing_svc.get_markup_multiplier(db)
        if image_model_id:
            image_model = await credit_svc.resolve_model(db, "image", image_model_id)
            if image_model is None:
                raise HTTPException(422, f"That image option for the {phase} phase is no longer available — pick another one.")
        else:
            # No explicit choice made — same graceful default as before
            # this was exposed as a real per-phase picker.
            image_model = models["image"][0] if models["image"] else None
        cost += pricing_svc.compute_image_credits(image_model, markup) if image_model else 2

    video_model = None
    video_total_duration = None
    if generate_video:
        if not video_model_id:
            raise HTTPException(422, f"Pick a video model for the {phase} phase before generating.")
        video_model = await credit_svc.resolve_model(db, "video", video_model_id)
        if video_model is None:
            raise HTTPException(422, f"That video option for the {phase} phase is no longer available — pick another one.")
        shots = video_shots or []
        shot_count = len(shots) if shots else 1
        if shot_count > credit_svc.MAX_VIDEO_SHOTS:
            raise HTTPException(422, f"The {phase} phase's video can have at most {credit_svc.MAX_VIDEO_SHOTS} shots (you asked for {shot_count}).")
        video_total_duration = sum(s.duration for s in shots) if shots else 6
        duration_options = video_model.get("duration_options")
        if duration_options:
            if video_total_duration not in duration_options:
                raise HTTPException(422, f"The {phase} phase's video length ({video_total_duration}s) isn't one of the exact durations \"{video_model['label']}\" supports: {', '.join(str(d) + 's' for d in duration_options)}.")
        elif not (video_model["min_duration"] <= video_total_duration <= video_model["max_duration"]):
            raise HTTPException(
                422,
                f"The {phase} phase's video length ({video_total_duration}s) is outside what "
                f"\"{video_model['label']}\" allows ({video_model['min_duration']}-{video_model['max_duration']}s total).",
            )
        offered = video_model.get("resolutions") or ["720p"]
        video_resolution = video_resolution or offered[0]
        if video_resolution not in offered:
            raise HTTPException(422, f"\"{video_model['label']}\" doesn't offer {video_resolution} for the {phase} phase — available: {', '.join(offered)}.")
        if video_mode == "first_last_frame":
            if not video_model.get("supports_last_frame"):
                raise HTTPException(422, f"\"{video_model['label']}\" doesn't support a separate start and end frame for the {phase} phase — pick a model with that capability, or switch to single reference image mode.")
            if not (video_frame_image or video_frame_image_url):
                raise HTTPException(422, f"The {phase} phase's start + end frame mode needs a starting frame image.")
            if not (video_end_frame_image or video_end_frame_image_url):
                raise HTTPException(422, f"The {phase} phase's start + end frame mode needs an ending frame image too.")
        # Campaigns don't have an audio toggle in the UI yet (scoped out
        # of this round) — dynamically-priced models fall back to
        # OpenRouter's own per-model default audio behavior.
        cost += pricing_svc.compute_video_credits(video_model, video_resolution, False, video_total_duration, markup, has_reference_image=bool(video_frame_image or video_frame_image_url))

    if cost > 0:
        bal = await credit_svc.balance(db, user.company_id)
        if bal < cost:
            raise HTTPException(402, f"Not enough credits: the {phase} phase costs {cost}, you have {bal}.")

    product_image_url = None
    if product_image:
        try:
            product_image_url = upload_data_url(product_image, prefix="uploads")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"Could not process the {phase} product photo: {exc}")

    video_frame_image_url_resolved = None
    if video_frame_image:
        try:
            video_frame_image_url_resolved = upload_data_url(video_frame_image, prefix="uploads")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"Could not process the {phase} video reference photo: {exc}")
    elif video_frame_image_url:
        video_frame_image_url_resolved = video_frame_image_url

    video_end_frame_image_url_resolved = None
    if video_mode == "first_last_frame":
        if video_end_frame_image:
            try:
                video_end_frame_image_url_resolved = upload_data_url(video_end_frame_image, prefix="uploads")
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(400, f"Could not process the {phase} end frame photo: {exc}")
        elif video_end_frame_image_url:
            video_end_frame_image_url_resolved = video_end_frame_image_url

    brand_logo_url = None
    brand_logo_placement = None
    if use_brand_logo:
        kit = await db.scalar(select(BrandKit).where(BrandKit.company_id == user.company_id))
        if kit:
            if kit.logo_url:
                brand_logo_url = kit.logo_url
                brand_logo_placement = kit.logo_placement
            if kit.tagline:
                caption = f"{caption}\n\n{kit.tagline}"

    variant = {p: {"caption": caption, "hashtags": [], "score": None, "tip": None} for p in platforms}
    ad = Ad(
        company_id=user.company_id, created_by=user.id,
        campaign_id=campaign.id, campaign_phase=phase,
        brief={
            "product_name": campaign.name, "description": campaign.brief,
            "audience": "", "offer": "", "goal": "Product launch", "tone": "Professional",
            "env": env, "image_scene": image_scene, "product_image_url": product_image_url,
            "brand_logo_url": brand_logo_url, "brand_logo_placement": brand_logo_placement,
            "image_model": image_model["model"] if image_model else None,
            "image_model_credits": image_model["credits"] if image_model else None,
            "video_model": video_model["model"] if video_model else None,
            "video_model_credits": video_model["credits"] if video_model else None,
            "video_shots": [s.model_dump() for s in video_shots] if video_shots else None,
            "video_frame_image_url": video_frame_image_url_resolved,
            "video_mode": video_mode if generate_video else None,
            "video_end_frame_image_url": video_end_frame_image_url_resolved,
            "refine_video_prompt": refine_video_prompt if generate_video else False,
            "refine_video_frame": refine_video_frame if generate_video else False,
            "video_resolution": video_resolution,
            "video_prompt_override": video_prompt_override,
        },
        platforms=platforms,
        outputs={"text": True, "image": generate_image, "video": generate_video, "format": "single", "variations": 1},
        results={"variants": [variant]},
        status="generating" if (generate_image or generate_video) else "ready",
    )
    db.add(ad)
    await db.flush()

    job_id = None
    if generate_image or generate_video:
        job = GenerationJob(company_id=user.company_id, ad_id=ad.id, kind="campaign_image", credits_cost=cost)
        db.add(job)
        db.add(CreditLedger(company_id=user.company_id, delta=-cost, reason="generation", ref_id=str(ad.id)))
        await db.flush()
        job_id = job.id

    return ad, cost, job_id


async def _compute_phase_status(db: AsyncSession, phases: dict) -> dict:
    """Live status per phase — never stored, always derived from the
    actual linked ad, so it can never drift out of sync with reality."""
    status = {}
    for phase in PHASES:
        info = phases.get(phase) or {}
        ad_id = info.get("ad_id")
        platforms = set(info.get("platforms", []))
        if not ad_id:
            status[phase] = "no_ad"
            continue
        ad = await db.get(Ad, uuid.UUID(ad_id))
        if ad is None:
            status[phase] = "no_ad"
            continue
        posted = set(ad.posted_platforms or [])
        if platforms and platforms.issubset(posted):
            status[phase] = "posted"
        elif posted:
            status[phase] = "partially_posted"
        else:
            status[phase] = "scheduled"
    return status


async def _campaign_out(db: AsyncSession, campaign: Campaign) -> CampaignOut:
    phase_status = await _compute_phase_status(db, campaign.phases or {})
    return CampaignOut(
        id=campaign.id, name=campaign.name, brief=campaign.brief,
        phases=campaign.phases, phase_status=phase_status, created_at=campaign.created_at,
    )


@router.post("", response_model=CampaignOut, status_code=201)
async def create_campaign(data: CampaignCreateIn, user: User = Depends(require_capability("manage_campaigns")), db: AsyncSession = Depends(get_db)):
    phase_extras = " ".join(filter(None, [
        data.teaser.env, data.teaser.image_scene,
        data.launch.env, data.launch.image_scene,
        data.followup.env, data.followup.image_scene,
    ]))
    hit = await check_text(db, user.company_id, user.id, f"{data.name} {data.brief} {phase_extras}")
    if hit:
        await db.commit()
        raise HTTPException(400, "Blocked by content guardrails (matched a prohibited term). This attempt has been logged.")

    bal = await credit_svc.balance(db, user.company_id)
    if bal < CAMPAIGN_COST:
        raise HTTPException(402, f"Not enough credits: a campaign costs {CAMPAIGN_COST}, you have {bal}.")

    try:
        parsed = await _call_claude_campaign(db, data.name, data.brief)
        captions = {p: parsed[p]["caption"] for p in PHASES}
    except Exception:  # noqa: BLE001
        captions = {p: c["caption"] for p, c in _fallback_phases(data.name).items()}

    phase_inputs: dict[str, PhaseScheduleIn] = {"teaser": data.teaser, "launch": data.launch, "followup": data.followup}

    campaign = Campaign(company_id=user.company_id, name=data.name, brief=data.brief, phases={})
    db.add(campaign)
    db.add(CreditLedger(company_id=user.company_id, delta=-CAMPAIGN_COST, reason="generation", ref_id="campaign"))
    await db.flush()  # need campaign.id before creating ads that reference it

    phases_out = {}
    pending_job_ids: list[uuid.UUID] = []
    for phase in PHASES:
        pin = phase_inputs[phase]
        ad, _cost, job_id = await _create_phase_ad(
            db, user, campaign, phase, captions[phase], pin.platforms, pin.generate_image,
            env=pin.env, image_scene=pin.image_scene, product_image=pin.product_image, use_brand_logo=pin.use_brand_logo,
            image_model_id=pin.image_model_id,
            generate_video=pin.generate_video, video_model_id=pin.video_model_id, video_shots=pin.video_shots,
            video_frame_image=pin.video_frame_image, video_frame_image_url=pin.video_frame_image_url,
            video_resolution=pin.video_resolution, video_prompt_override=pin.video_prompt_override,
            video_mode=pin.video_mode, video_end_frame_image=pin.video_end_frame_image,
            video_end_frame_image_url=pin.video_end_frame_image_url, refine_video_prompt=pin.refine_video_prompt,
            refine_video_frame=pin.refine_video_frame,
        )
        if job_id:
            pending_job_ids.append(job_id)

        scheduled_at = datetime.combine(date.fromisoformat(pin.date), time.fromisoformat(pin.time))
        await retention_svc.validate_schedule_within_retention(db, ad.created_at, scheduled_at)
        for platform in pin.platforms:
            db.add(ScheduledPost(company_id=user.company_id, ad_id=ad.id, platform=platform, scheduled_at=scheduled_at))
        ad.status = "scheduled" if ad.status == "ready" else ad.status  # keep "generating" if an image job is running

        phases_out[phase] = {
            "caption": captions[phase], "date": pin.date, "time": pin.time,
            "platforms": pin.platforms, "ad_id": str(ad.id),
        }

    campaign.phases = phases_out
    flag_modified(campaign, "phases")
    db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="campaign.generated",
                    detail={"name": data.name, "phases": {p: phase_inputs[p].platforms for p in PHASES}}))
    await db.commit()
    await db.refresh(campaign)

    # Dispatch Celery tasks ONLY after the commit above has actually landed —
    # the worker uses a separate database connection and won't see these
    # jobs at all if we send the task while the transaction is still open
    # (confirmed: this was a real bug — the worker logged "job not found"
    # for both image jobs on the very first test of this endpoint).
    for jid in pending_job_ids:
        celery_app.send_task("app.generate_campaign_ad_image", args=[str(jid)])

    return await _campaign_out(db, campaign)


@router.get("", response_model=CampaignListOut)
async def list_campaigns(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Campaign).where(Campaign.company_id == user.company_id)
    if date_from:
        stmt = stmt.where(Campaign.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        stmt = stmt.where(Campaign.created_at < datetime.combine(date_to + timedelta(days=1), time.min))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = (await db.scalars(
        stmt.order_by(Campaign.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )).all()
    items = [await _campaign_out(db, c) for c in rows]
    return CampaignListOut(items=items, total=total or 0, page=page, page_size=page_size)


@router.delete("/{campaign_id}", status_code=204)
async def delete_campaign(campaign_id: uuid.UUID, user: User = Depends(require_capability("manage_campaigns")), db: AsyncSession = Depends(get_db)):
    campaign = await db.get(Campaign, campaign_id)
    if campaign is None or campaign.company_id != user.company_id:
        raise HTTPException(404, "Campaign not found")
    # Detach (don't delete) any ads generated from this campaign, and cancel
    # any still-pending scheduled posts tied to them — the ads themselves,
    # including anything already posted, survive the campaign's removal.
    await db.execute(
        update(Ad).where(Ad.campaign_id == campaign_id).values(campaign_id=None, campaign_phase=None)
    )
    ad_ids = [str(v.get("ad_id")) for v in (campaign.phases or {}).values() if v.get("ad_id")]
    if ad_ids:
        await db.execute(
            update(ScheduledPost).where(
                ScheduledPost.ad_id.in_([uuid.UUID(a) for a in ad_ids]), ScheduledPost.status == "pending"
            ).values(status="canceled")
        )
    await db.delete(campaign)
    await db.commit()


@router.post("/{campaign_id}/image", response_model=AdCreatedOut)
async def generate_phase_image(
    campaign_id: uuid.UUID, data: CampaignImageIn,
    user: User = Depends(require_capability("manage_campaigns")), db: AsyncSession = Depends(get_db),
):
    """Adds or regenerates the image on a phase's ALREADY-CREATED ad — ads
    are now created automatically at campaign creation time (with their
    schedule), so this only ever operates on an existing ad, never creates
    a new one."""
    campaign = await db.get(Campaign, campaign_id)
    if campaign is None or campaign.company_id != user.company_id:
        raise HTTPException(404, "Campaign not found")
    if not campaign.phases or data.phase not in campaign.phases:
        raise HTTPException(404, f"Phase '{data.phase}' not found on this campaign")

    ad_id = campaign.phases[data.phase].get("ad_id")
    if not ad_id:
        raise HTTPException(409, "This phase has no ad yet — this shouldn't normally happen for campaigns created going forward.")
    ad = await db.get(Ad, uuid.UUID(ad_id))
    if ad is None:
        raise HTTPException(404, "Linked ad not found")

    cost = ad.brief.get("image_model_credits") or 2  # reuse the SAME cost as this phase's original image model, not a re-lookup
    bal = await credit_svc.balance(db, user.company_id)
    if bal < cost:
        raise HTTPException(402, f"Not enough credits: the image costs {cost}, you have {bal}.")

    product_image_url = None
    if data.product_image:
        try:
            product_image_url = upload_data_url(data.product_image, prefix="uploads")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"Could not process the uploaded product photo: {exc}")

    brand_logo_url = None
    brand_logo_placement = None
    brief = dict(ad.brief)
    if data.use_brand_logo:
        kit = await db.scalar(select(BrandKit).where(BrandKit.company_id == user.company_id))
        if kit:
            if kit.logo_url:
                brand_logo_url = kit.logo_url
                brand_logo_placement = kit.logo_placement
            if kit.tagline and kit.tagline not in (ad.results or {}).get("variants", [{}])[0].get(ad.platforms[0], {}).get("caption", ""):
                # append tagline to every platform's caption once, if not already present
                variants = list(ad.results["variants"])
                v0 = dict(variants[0])
                for p in ad.platforms:
                    if p in v0:
                        v0[p] = {**v0[p], "caption": f"{v0[p]['caption']}\n\n{kit.tagline}"}
                variants[0] = v0
                ad.results = {"variants": variants}
                flag_modified(ad, "results")

    brief["env"] = data.env
    brief["image_scene"] = data.image_scene
    brief["product_image_url"] = product_image_url
    brief["brand_logo_url"] = brand_logo_url
    brief["brand_logo_placement"] = brand_logo_placement
    ad.brief = brief
    flag_modified(ad, "brief")
    ad.status = "generating"

    job = GenerationJob(company_id=user.company_id, ad_id=ad.id, kind="campaign_image", credits_cost=cost)
    db.add(job)
    db.add(CreditLedger(company_id=user.company_id, delta=-cost, reason="generation", ref_id=str(ad.id)))
    await db.flush()
    job_id = job.id
    await db.commit()

    celery_app.send_task("app.generate_campaign_ad_image", args=[str(job_id)])
    return AdCreatedOut(ad_id=ad.id, job_id=job_id, credits_cost=cost)
