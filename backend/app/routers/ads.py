import asyncio
import uuid
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_capability
from app.models import Ad, AuditLog, BrandKit, Campaign, CreditLedger, GenerationJob, PlatformConnection, Product, ScheduledPost, User
from app.schemas import (
    AdCreateIn, AdCreatedOut, AdListOut, AdOut, AdPatchIn, AdScheduledPostOut, AvailableModelOut,
    AvailableModelsOut, PostAdIn, PreviewCostIn, PreviewCostOut, PromptPreviewIn, PromptPreviewOut,
    RefineIn, RetentionInfoOut,
)
from app.services import credits as credit_svc
from app.services import linkedin
from app.services import pricing as pricing_svc
from app.services import retention as retention_svc
from app.services import video_prep as video_prep_svc
from app.services.guardrails import check_text
from app.services.storage import upload_data_url
from app.services.token_crypto import decrypt_token
from app.tasks import _build_prompt, _image_prompt, _multi_shot_video_prompt, _review_shot_prompt, _video_prompt
from app.worker import celery_app

router = APIRouter(prefix="/ads", tags=["ads"])


def _compute_display_status(ad: Ad, has_pending_schedule: bool) -> str:
    """The stored ad.status is written at many different moments (creation,
    image-generation success/failure, manual posting, the Beat job) and it's
    proven error-prone to keep every one of those writes perfectly correct
    for every case (e.g. a campaign phase's image finishing generation
    forgetting it still has a pending schedule). So the status actually
    SHOWN is derived here, live, from the things that are unambiguous:
    posted_platforms vs. the ad's platform list, and whether any schedule
    is still pending — this can't drift out of sync the way a written
    status can."""
    if ad.status in ("generating", "failed", "draft", "pending_approval", "approved"):
        return ad.status  # in-progress / explicit workflow states are always shown as-is
    platforms = set(ad.platforms or [])
    posted = set(ad.posted_platforms or [])
    if platforms and platforms.issubset(posted):
        return "posted"
    if posted:
        return "partially_posted"
    if has_pending_schedule:
        return "scheduled"
    return ad.status


def _ad_out(
    ad: Ad, error: str | None = None, campaign_name: str | None = None,
    has_pending_schedule: bool = False, next_scheduled_at=None,
    scheduled_posts: list[AdScheduledPostOut] | None = None,
) -> AdOut:
    return AdOut(
        id=ad.id, status=_compute_display_status(ad, has_pending_schedule), brief=ad.brief, platforms=ad.platforms,
        outputs=ad.outputs, results=ad.results, favorite=ad.favorite,
        product_id=ad.product_id, campaign_id=ad.campaign_id, campaign_phase=ad.campaign_phase,
        campaign_name=campaign_name, posted_at=ad.posted_at,
        posted_platforms=ad.posted_platforms or [],
        next_scheduled_at=next_scheduled_at,
        scheduled_posts=scheduled_posts or [],
        created_at=ad.created_at, error=error,
    )


@router.get("/available-models", response_model=AvailableModelsOut)
async def get_available_models_endpoint(user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    """Powers Create Ad's model dropdowns — one call gets both image and
    video options, each with its cost (and for video, duration range)
    but never a model slug/name (see AvailableModelOut). Any active user
    who can create ads can call this, not just admins — everyone using
    Create Ad needs to see the real options to pick from.

    For models with dynamic pricing (see services/pricing.py), the
    `credits` returned here is a REFERENCE number (the cost of the
    cheapest offered resolution, minimum duration, no audio) — it's
    there so the dropdown shows *something* before a specific
    combination is chosen. The frontend calls POST /ads/preview-cost
    once resolution/audio/duration are actually selected to get the
    real total."""
    models = await credit_svc.get_available_models(db)
    markup = await pricing_svc.get_markup_multiplier(db)

    text_out = []
    for m in models["text"]:
        if not m.get("enabled", True):
            continue
        has_dynamic = bool(m.get("pricing", {}).get("cost_usd"))
        credits = pricing_svc.compute_text_credits(m, markup) if has_dynamic else m["credits"]
        text_out.append(AvailableModelOut(id=m["id"], label=m["label"], credits=credits, has_dynamic_pricing=has_dynamic))

    image_out = []
    for m in models["image"]:
        if not m.get("enabled", True):
            continue
        has_dynamic = bool(m.get("pricing", {}).get("cost_usd"))
        credits = pricing_svc.compute_image_credits(m, markup) if has_dynamic else m["credits"]
        image_out.append(AvailableModelOut(id=m["id"], label=m["label"], credits=credits, has_dynamic_pricing=has_dynamic))

    video_out = []
    for m in models["video"]:
        if not m.get("enabled", True):
            continue
        p = m.get("pricing") or {}
        has_dynamic = bool(p.get("rates_usd_per_second"))
        if has_dynamic:
            ref_resolution = (m.get("resolutions") or [None])[0]
            ref_duration = m.get("min_duration") or (m.get("duration_options") or [6])[0]
            credits = pricing_svc.compute_video_credits(m, ref_resolution, False, ref_duration, markup)
        else:
            credits = m["credits"]
        video_out.append(AvailableModelOut(
            id=m["id"], label=m["label"], credits=credits,
            min_duration=m.get("min_duration"), max_duration=m.get("max_duration"),
            duration_options=m.get("duration_options"), resolutions=m.get("resolutions"),
            supports_audio=m.get("supports_audio", False) or (has_dynamic and p.get("supports_audio", False)),
            supports_last_frame=m.get("supports_last_frame", False),
            has_dynamic_pricing=has_dynamic,
        ))

    return AvailableModelsOut(text=text_out, image=image_out, video=video_out)


@router.get("/retention-info", response_model=RetentionInfoOut)
async def get_retention_info(_: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Company-facing — both numbers, for the generation-time notice,
    the confirmation popup, and the My Ads page warning. Any active
    user can read this, not just admins — everyone generating or
    viewing ads should see it."""
    return RetentionInfoOut(
        retention_months=await retention_svc.get_retention_months(db),
        post_retention_months=await retention_svc.get_post_retention_months(db),
    )


@router.post("/preview-cost", response_model=PreviewCostOut)
async def preview_cost(data: PreviewCostIn, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    """The real, exact credit cost for a specific combination — called
    live as the customer changes resolution/audio/duration in Create
    Ad, so the price shown is always accurate for what they've actually
    selected, not a rough reference number. Deliberately returns ONLY
    the credit total, never the underlying $ formula — the pricing
    structure itself stays developer-only (see AvailableModelOut)."""
    models = await credit_svc.get_available_models(db)
    entry = next((m for m in models.get(data.kind, []) if m["id"] == data.model_id and m.get("enabled", True)), None)
    if entry is None:
        raise HTTPException(404, "That option is no longer available — pick another one.")
    markup = await pricing_svc.get_markup_multiplier(db)
    if data.kind == "text":
        return PreviewCostOut(credits=pricing_svc.compute_text_credits(entry, markup))
    if data.kind == "image":
        return PreviewCostOut(credits=pricing_svc.compute_image_credits(entry, markup))
    duration = data.duration_seconds or entry.get("min_duration") or 6
    return PreviewCostOut(credits=pricing_svc.compute_video_credits(entry, data.resolution, data.audio, duration, markup, has_reference_image=data.has_reference_image))


@router.post("/preview-prompt", response_model=PromptPreviewOut)
async def preview_prompt(data: PromptPreviewIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    brief = {
        "product_name": data.product_name, "description": data.description,
        "audience": data.audience, "offer": data.offer, "goal": data.goal,
        "tone": data.tone, "env": data.env, "image_scene": data.image_scene,
        "tagline": data.tagline,
        "product_image_url": "preview-only" if data.has_photo else None,
    }
    outputs = {**data.outputs, "format": data.format, "variations": data.variations}
    text_prompt = _build_prompt(brief, data.platforms, outputs, feedback=None)
    image_prompt = _image_prompt(brief) if data.outputs.get("image") else None
    # Video prompt now runs through the SAME shot-review step generation
    # itself uses (if the developer has one configured — see
    # services/video_prep.py) BEFORE being built and shown — so what the
    # customer previews and can edit here is genuinely what would be
    # generated, not the raw pre-review wording. Reviewed shots are
    # returned too (reviewed_shots) so the frontend can update its own
    # shot list to match, keeping Step 2 and this preview in sync.
    video_prompt = None
    reviewed_shots = None
    if data.outputs.get("video") and data.video_shots:
        shots = [s.model_dump() for s in data.video_shots]
        if data.refine_video_prompt:
            prep_settings = await video_prep_svc.get_video_prep_settings(db)
            if prep_settings.get("prompt_review_model_id"):
                review_models = await credit_svc.get_available_models(db)
                review_entry = next((m for m in review_models.get("text", []) if m["id"] == prep_settings["prompt_review_model_id"]), None)
                if review_entry:
                    for shot in shots:
                        if shot.get("prompt"):
                            shot["prompt"] = await asyncio.to_thread(_review_shot_prompt, shot["prompt"], review_entry["model"])
                    reviewed_shots = shots
        video_prompt = _video_prompt(brief, shots[0].get("prompt")) if len(shots) == 1 else _multi_shot_video_prompt(brief, shots)
    return PromptPreviewOut(text_prompt=text_prompt, image_prompt=image_prompt, video_prompt=video_prompt, reviewed_shots=reviewed_shots)


@router.post("", response_model=AdCreatedOut, status_code=201)
async def create_ad(data: AdCreateIn, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    combined = " ".join(filter(None, [
        data.product_name, data.description, data.audience, data.offer,
        data.env or "", data.image_scene or "", data.tagline or "",
        " ".join(data.carousel_slides or []),
        " ".join(s.prompt for s in (data.video_shots or [])),
    ]))
    hit = await check_text(db, user.company_id, user.id, combined)
    if hit:
        await db.commit()
        raise HTTPException(400, "Blocked by content guardrails (matched a prohibited term). This attempt has been logged.")

    carousel_count = 1
    if data.format == "carousel":
        carousel_count = len(data.carousel_slides) if data.carousel_slides else 2
        if carousel_count < 2:
            raise HTTPException(422, "A carousel needs at least 2 images.")
        if carousel_count > settings.CAROUSEL_MAX_IMAGES:
            raise HTTPException(422, f"A carousel can have at most {settings.CAROUSEL_MAX_IMAGES} images (you asked for {carousel_count}).")

    text_model = None
    if data.outputs.get("text"):
        if not data.text_model_id:
            raise HTTPException(422, "Pick a text model before generating.")
        text_model = await credit_svc.resolve_model(db, "text", data.text_model_id)
        if text_model is None:
            raise HTTPException(422, "That text option is no longer available — pick another one.")

    image_model = None
    if data.outputs.get("image"):
        if not data.image_model_id:
            raise HTTPException(422, "Pick an image model before generating.")
        image_model = await credit_svc.resolve_model(db, "image", data.image_model_id)
        if image_model is None:
            raise HTTPException(422, "That image option is no longer available — pick another one.")

    video_model = None
    video_resolution = None
    if data.outputs.get("video"):
        if not data.video_model_id:
            raise HTTPException(422, "Pick a video model before generating.")
        video_model = await credit_svc.resolve_model(db, "video", data.video_model_id)
        if video_model is None:
            raise HTTPException(422, "That video option is no longer available — pick another one.")

        offered = video_model.get("resolutions") or ["720p"]
        video_resolution = data.video_resolution or offered[0]
        if video_resolution not in offered:
            raise HTTPException(422, f"\"{video_model['label']}\" doesn't offer {video_resolution} — available: {', '.join(offered)}.")

        if data.video_mode == "first_last_frame":
            if not video_model.get("supports_last_frame"):
                raise HTTPException(422, f"\"{video_model['label']}\" doesn't support a separate start and end frame — pick a model with that capability, or switch to the single reference image mode.")
            if not (data.video_frame_image or data.video_frame_image_url):
                raise HTTPException(422, "Start + end frame mode needs a starting frame image.")
            if not (data.video_end_frame_image or data.video_end_frame_image_url):
                raise HTTPException(422, "Start + end frame mode needs an ending frame image too.")

        shots = data.video_shots or []
        shot_count = len(shots) if shots else 1
        if shot_count > credit_svc.MAX_VIDEO_SHOTS:
            raise HTTPException(422, f"A video can have at most {credit_svc.MAX_VIDEO_SHOTS} shots (you asked for {shot_count}).")
        total_duration = sum(s.duration for s in shots) if shots else 6
        duration_options = video_model.get("duration_options")
        if duration_options:
            if total_duration not in duration_options:
                raise HTTPException(
                    422,
                    f"This video's total length ({total_duration}s across {shot_count} shot(s)) isn't one of the exact durations "
                    f"\"{video_model['label']}\" supports: {', '.join(str(d) + 's' for d in duration_options)}. "
                    f"Pick a different video option, or adjust the shot durations to add up to one of those exactly.",
                )
        elif not (video_model["min_duration"] <= total_duration <= video_model["max_duration"]):
            raise HTTPException(
                422,
                f"This video's total length ({total_duration}s across {shot_count} shot(s)) is outside what "
                f"\"{video_model['label']}\" allows ({video_model['min_duration']}-{video_model['max_duration']}s total). "
                f"Pick a different video option, or adjust the shot durations.",
            )

    markup = await pricing_svc.get_markup_multiplier(db)
    text_credits_resolved = pricing_svc.compute_text_credits(text_model, markup) if text_model else None
    image_credits_resolved = pricing_svc.compute_image_credits(image_model, markup) if image_model else None
    video_has_reference = bool(data.video_frame_image or data.video_frame_image_url)
    video_credits_resolved = pricing_svc.compute_video_credits(video_model, video_resolution, data.video_audio, total_duration, markup, has_reference_image=video_has_reference) if video_model else None

    cost = credit_svc.generation_cost(
        text_credits_resolved,
        image_credits_resolved,
        video_credits_resolved,
        data.format, data.variations, carousel_count,
    )
    bal = await credit_svc.balance(db, user.company_id)
    if bal < cost:
        raise HTTPException(402, f"Not enough credits: this generation costs {cost}, you have {bal}. Upgrade your plan or top up.")

    product_image_url = None
    if data.product_image:
        try:
            product_image_url = upload_data_url(data.product_image, prefix="uploads")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"Could not process the uploaded product photo: {exc}")
    elif data.product_image_url:
        product_image_url = data.product_image_url

    video_frame_image_url = None
    if data.video_frame_image:
        try:
            video_frame_image_url = upload_data_url(data.video_frame_image, prefix="uploads")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"Could not process the uploaded video reference photo: {exc}")
    elif data.video_frame_image_url:
        video_frame_image_url = data.video_frame_image_url

    video_end_frame_image_url = None
    if data.video_mode == "first_last_frame":
        if data.video_end_frame_image:
            try:
                video_end_frame_image_url = upload_data_url(data.video_end_frame_image, prefix="uploads")
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(400, f"Could not process the uploaded end frame photo: {exc}")
        elif data.video_end_frame_image_url:
            video_end_frame_image_url = data.video_end_frame_image_url

    image_reference_image_url = None
    if data.image_reference_image:
        try:
            image_reference_image_url = upload_data_url(data.image_reference_image, prefix="uploads")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"Could not process the uploaded image reference photo: {exc}")
    elif data.image_reference_image_url:
        image_reference_image_url = data.image_reference_image_url

    brand_logo_url = None
    brand_logo_placement = None
    if data.use_brand_logo:
        kit = await db.scalar(select(BrandKit).where(BrandKit.company_id == user.company_id))
        if kit and kit.logo_url:
            brand_logo_url = kit.logo_url
            brand_logo_placement = kit.logo_placement

    # Validate the product belongs to this company before linking (categorization).
    product_id = None
    if data.product_id:
        product = await db.get(Product, data.product_id)
        if product and product.company_id == user.company_id:
            product_id = product.id

    ad = Ad(
        company_id=user.company_id, created_by=user.id, product_id=product_id,
        brief={
            "product_name": data.product_name, "description": data.description,
            "audience": data.audience, "offer": data.offer, "goal": data.goal,
            "tone": data.tone, "env": data.env, "image_scene": data.image_scene,
            "tagline": data.tagline, "product_image_url": product_image_url,
            "image_reference_image_url": image_reference_image_url,
            "text_prompt_override": data.text_prompt_override,
            "image_prompt_override": data.image_prompt_override,
            "brand_logo_url": brand_logo_url,
            "brand_logo_placement": brand_logo_placement,
            "carousel_slides": data.carousel_slides,
            "video_shots": [s.model_dump() for s in data.video_shots] if data.video_shots else None,
            "video_frame_image_url": video_frame_image_url,
            "video_prompt_override": data.video_prompt_override,
            "image_model": image_model["model"] if image_model else None,
            "image_model_credits": image_model["credits"] if image_model else None,
            "video_model": video_model["model"] if video_model else None,
            "video_model_credits": video_model["credits"] if video_model else None,
            "video_resolution": video_resolution,
            "video_mode": data.video_mode if video_model else None,
            "video_end_frame_image_url": video_end_frame_image_url,
            "refine_video_prompt": data.refine_video_prompt if video_model else False,
            "refine_video_frame": data.refine_video_frame if video_model else False,
            "video_audio": data.video_audio if video_model else None,
            "text_model": text_model["model"] if text_model else None,
            "text_model_credits": text_model["credits"] if text_model else None,
        },
        platforms=data.platforms,
        outputs={**data.outputs, "format": data.format, "variations": data.variations},
        status="generating",
    )
    db.add(ad)
    await db.flush()

    job = GenerationJob(company_id=user.company_id, ad_id=ad.id, kind="ad", credits_cost=cost)
    db.add(job)
    db.add(CreditLedger(company_id=user.company_id, delta=-cost, reason="generation", ref_id=str(ad.id)))
    db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="ad.generation_started",
                    detail={"ad_id": str(ad.id), "cost": cost, "platforms": data.platforms}))
    await db.flush()
    job_id = job.id
    await db.commit()

    celery_app.send_task("app.generate_ad", args=[str(job_id)])
    return AdCreatedOut(ad_id=ad.id, job_id=job_id, credits_cost=cost)


@router.get("", response_model=AdListOut)
async def list_ads(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    date_from: date | None = None,
    date_to: date | None = None,
    product_id: uuid.UUID | None = None,
    campaign_id: uuid.UUID | None = None,
    no_campaign: bool = False,  # filter to ads NOT linked to any campaign
    status_filter: str | None = Query(None, pattern="^(created|scheduled|posted)$"),
    user: User = Depends(require_capability("view_my_ads")),
    db: AsyncSession = Depends(get_db),
):
    """Paginated ad list with optional date-range, product-category,
    campaign, and status filters. Date filters apply to created_at (when
    the ad was generated).

    status_filter uses the SAME underlying signals as the computed
    display status (posted_platforms coverage + pending schedules) —
    NOT the raw stored ad.status column, for the same reason that column
    isn't trusted for display: it isn't reliably kept in sync at every
    write site. Applied at the SQL level (not after fetching) so
    pagination counts stay correct."""
    stmt = select(Ad).where(Ad.company_id == user.company_id)
    if date_from:
        stmt = stmt.where(Ad.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        stmt = stmt.where(Ad.created_at < datetime.combine(date_to + timedelta(days=1), time.min))
    if product_id:
        stmt = stmt.where(Ad.product_id == product_id)
    if campaign_id:
        stmt = stmt.where(Ad.campaign_id == campaign_id)
    elif no_campaign:
        stmt = stmt.where(Ad.campaign_id.is_(None))

    has_posted = func.json_array_length(Ad.posted_platforms) > 0
    has_pending_schedule_expr = exists(
        select(ScheduledPost.id).where(ScheduledPost.ad_id == Ad.id, ScheduledPost.status == "pending")
    )
    if status_filter == "posted":
        stmt = stmt.where(has_posted)
    elif status_filter == "scheduled":
        stmt = stmt.where(has_pending_schedule_expr, ~has_posted)
    elif status_filter == "created":
        stmt = stmt.where(~has_posted, ~has_pending_schedule_expr)

    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = (await db.scalars(
        stmt.order_by(Ad.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )).all()

    # One batch query for all campaign names on this page, instead of a
    # separate lookup per ad (N+1).
    camp_ids = {a.campaign_id for a in rows if a.campaign_id}
    campaign_names: dict[uuid.UUID, str] = {}
    if camp_ids:
        camp_rows = (await db.scalars(select(Campaign).where(Campaign.id.in_(camp_ids)))).all()
        campaign_names = {c.id: c.name for c in camp_rows}

    # One batch query for EVERY still-pending schedule row per ad on this
    # page (not just the earliest) — powers My Ads showing each
    # platform's schedule individually, with its own cancel/reschedule,
    # now that the standalone Schedule page's job lives here instead.
    ad_ids = [a.id for a in rows]
    scheduled_by_ad: dict[uuid.UUID, list[AdScheduledPostOut]] = {}
    if ad_ids:
        pending_rows = (await db.scalars(
            select(ScheduledPost)
            .where(ScheduledPost.ad_id.in_(ad_ids), ScheduledPost.status == "pending")
            .order_by(ScheduledPost.scheduled_at.asc())
        )).all()
        for r in pending_rows:
            scheduled_by_ad.setdefault(r.ad_id, []).append(AdScheduledPostOut(id=r.id, platform=r.platform, scheduled_at=r.scheduled_at))

    items = [
        _ad_out(
            a, campaign_name=campaign_names.get(a.campaign_id) if a.campaign_id else None,
            has_pending_schedule=a.id in scheduled_by_ad,
            next_scheduled_at=scheduled_by_ad[a.id][0].scheduled_at if a.id in scheduled_by_ad else None,
            scheduled_posts=scheduled_by_ad.get(a.id, []),
        )
        for a in rows
    ]
    return AdListOut(items=items, total=total or 0, page=page, page_size=page_size)


@router.get("/{ad_id}", response_model=AdOut)
async def get_ad(ad_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ad = await db.get(Ad, ad_id)
    if ad is None or ad.company_id != user.company_id:
        raise HTTPException(404, "Ad not found")
    # Always check the latest job's error, regardless of the ad's overall
    # status — a "ready" ad can still have a real error worth surfacing
    # (e.g. copy succeeded but the image failed; the ad stays usable/ready
    # on purpose, but the customer needs to know the image didn't generate).
    # Previously this only checked failed/generating ads, which silently
    # hid exactly the "partial failure, still ready" case it was meant for.
    job = await db.scalar(
        select(GenerationJob).where(GenerationJob.ad_id == ad.id)
        .order_by(GenerationJob.created_at.desc())
    )
    error = job.error if job else None
    campaign_name = None
    if ad.campaign_id:
        campaign = await db.get(Campaign, ad.campaign_id)
        campaign_name = campaign.name if campaign else None
    pending_rows = (await db.scalars(
        select(ScheduledPost).where(ScheduledPost.ad_id == ad.id, ScheduledPost.status == "pending")
        .order_by(ScheduledPost.scheduled_at.asc())
    )).all()
    scheduled_posts = [AdScheduledPostOut(id=r.id, platform=r.platform, scheduled_at=r.scheduled_at) for r in pending_rows]
    return _ad_out(
        ad, error, campaign_name, has_pending_schedule=bool(scheduled_posts),
        next_scheduled_at=scheduled_posts[0].scheduled_at if scheduled_posts else None,
        scheduled_posts=scheduled_posts,
    )


@router.post("/{ad_id}/refine", response_model=AdCreatedOut)
async def refine_ad(ad_id: uuid.UUID, data: RefineIn, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    ad = await db.get(Ad, ad_id)
    if ad is None or ad.company_id != user.company_id:
        raise HTTPException(404, "Ad not found")
    if ad.status not in ("ready", "posted", "scheduled"):
        raise HTTPException(409, f"Ad is not ready to refine (status: {ad.status})")

    hit = await check_text(db, user.company_id, user.id, data.feedback)
    if hit:
        await db.commit()
        raise HTTPException(400, "Blocked by content guardrails (matched a prohibited term). This attempt has been logged.")

    prev_status = ad.status
    ad.status = "generating"
    job = GenerationJob(company_id=user.company_id, ad_id=ad.id, kind="refine", credits_cost=0)
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()

    celery_app.send_task("app.generate_ad", args=[str(job_id)], kwargs={"feedback": data.feedback, "variant": data.variant})
    return AdCreatedOut(ad_id=ad.id, job_id=job_id, credits_cost=0)


@router.post("/{ad_id}/refine-image", response_model=AdCreatedOut)
async def refine_image(ad_id: uuid.UUID, data: RefineIn, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    ad = await db.get(Ad, ad_id)
    if ad is None or ad.company_id != user.company_id:
        raise HTTPException(404, "Ad not found")
    if ad.status not in ("ready", "posted", "scheduled"):
        raise HTTPException(409, f"Ad is not ready to edit (status: {ad.status})")
    if not (ad.results and ad.results.get("variants") and ad.results["variants"][data.variant].get("image_url")):
        raise HTTPException(409, "No existing image to edit — generate an image first.")

    hit = await check_text(db, user.company_id, user.id, data.feedback)
    if hit:
        await db.commit()
        raise HTTPException(400, "Blocked by content guardrails (matched a prohibited term). This attempt has been logged.")

    cost = ad.brief.get("image_model_credits") or 2  # reuse the SAME cost as the ad's original image model, not a re-lookup — matches whatever generated it in the first place, robust even if that model has since been removed from the list
    bal = await credit_svc.balance(db, user.company_id)
    if bal < cost:
        raise HTTPException(402, f"Not enough credits: editing the image costs {cost}, you have {bal}.")

    ad.status = "generating"
    job = GenerationJob(company_id=user.company_id, ad_id=ad.id, kind="image_edit", credits_cost=cost)
    db.add(job)
    db.add(CreditLedger(company_id=user.company_id, delta=-cost, reason="generation", ref_id=str(ad.id)))
    await db.flush()
    job_id = job.id
    await db.commit()

    celery_app.send_task("app.edit_ad_image", args=[str(job_id)], kwargs={"feedback": data.feedback, "variant": data.variant})
    return AdCreatedOut(ad_id=ad.id, job_id=job_id, credits_cost=cost)


@router.post("/{ad_id}/retry-without-reference", response_model=AdCreatedOut)
async def retry_without_reference(ad_id: uuid.UUID, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    """The user-confirmed retry after a REFERENCE_REJECTED failure (see
    tasks.py) — deliberately a separate, explicit action the user must
    click, not an automatic fallback. Re-runs the exact same generation
    (same prompt, same everything) with skip_reference=True, so the
    reference photo that caused the rejection is genuinely left out this
    time, not silently substituted the first time it fails."""
    ad = await db.get(Ad, ad_id)
    if ad is None or ad.company_id != user.company_id:
        raise HTTPException(404, "Ad not found")

    last_job = await db.scalar(
        select(GenerationJob).where(GenerationJob.ad_id == ad.id).order_by(GenerationJob.created_at.desc()).limit(1)
    )
    if not last_job or "REFERENCE_REJECTED::" not in (last_job.error or ""):
        raise HTTPException(409, "This ad doesn't have a reference-related failure to retry from.")

    cost = (ad.brief.get("image_model_credits") or 0) + (ad.brief.get("video_model_credits") or 0)
    cost = max(1, cost)
    bal = await credit_svc.balance(db, user.company_id)
    if bal < cost:
        raise HTTPException(402, f"Not enough credits: retrying costs {cost}, you have {bal}.")

    ad.status = "generating"
    job = GenerationJob(company_id=user.company_id, ad_id=ad.id, kind="retry_no_reference", credits_cost=cost)
    db.add(job)
    db.add(CreditLedger(company_id=user.company_id, delta=-cost, reason="generation", ref_id=str(ad.id)))
    await db.flush()
    job_id = job.id
    await db.commit()

    task_name = "app.generate_campaign_ad_image" if ad.campaign_id else "app.generate_ad"
    celery_app.send_task(task_name, args=[str(job_id)], kwargs={"skip_reference": True})
    return AdCreatedOut(ad_id=ad.id, job_id=job_id, credits_cost=cost)


@router.post("/{ad_id}/post", response_model=AdOut)
async def post_ad(ad_id: uuid.UUID, data: PostAdIn, user: User = Depends(require_capability("post_content")), db: AsyncSession = Depends(get_db)):
    """Marks specific platforms as posted (adds to posted_platforms, does not
    replace it) — supports posting to more platforms later, or reposting to
    the same ones again after edits. Sets posted_at the FIRST time an ad is
    posted; later posts don't move that original date.

    For platforms with a real, connected integration (currently just
    LinkedIn — see services/linkedin.py) and MOCK_POSTING=False, this
    actually publishes. Everything else still uses the same honest
    simulated-posting behavior the app has always had. Each platform is
    attempted independently: if LinkedIn's real API call fails, that
    platform is NOT marked posted and the failure is reported, but
    other platforms in the same request still go through."""
    ad = await db.get(Ad, ad_id)
    if ad is None or ad.company_id != user.company_id:
        raise HTTPException(404, "Ad not found")
    # "scheduled" is included deliberately — this is exactly the case of a
    # customer manually posting an ad early, before its scheduled time
    # arrives (e.g. a campaign phase). That must be allowed, not rejected.
    if ad.status not in ("ready", "posted", "scheduled"):
        raise HTTPException(409, f"Ad is not ready to post (status: {ad.status})")

    succeeded: list[str] = []
    failed: dict[str, str] = {}
    variant = (ad.results or {}).get("variants", [{}])[0] if ad.results else {}
    for platform in data.platforms:
        if platform == "linkedin" and not settings.MOCK_POSTING:
            conn = await db.scalar(select(PlatformConnection).where(
                PlatformConnection.company_id == user.company_id, PlatformConnection.platform == "linkedin",
            ))
            if conn and conn.status == "connected":
                try:
                    access_token = decrypt_token(conn.encrypted_token)
                    person_urn = linkedin.get_person_urn(access_token)
                    caption = (variant.get(platform) or {}).get("caption") or ""
                    linkedin.post_to_linkedin(access_token, person_urn, caption)
                    succeeded.append(platform)
                except Exception as exc:  # noqa: BLE001
                    failed[platform] = str(exc)[:300]
                continue
            failed[platform] = "LinkedIn isn't connected — connect it in Settings first."
            continue
        # Every other platform (or LinkedIn while MOCK_POSTING=True) —
        # no real integration built yet, same honest simulated posting
        # the app has always done.
        succeeded.append(platform)

    if succeeded:
        current = set(ad.posted_platforms or [])
        current.update(succeeded)
        ad.posted_platforms = list(current)
        flag_modified(ad, "posted_platforms")
        if ad.posted_at is None:
            ad.posted_at = datetime.utcnow()
        ad.status = "posted"

        # If this ad had pending scheduled posts for these platforms (e.g. a
        # campaign phase posted manually, ahead of its scheduled time), resolve
        # them now — otherwise they'd keep showing as "upcoming" in Schedule,
        # and the Beat job would try to fire them again later.
        pending = (await db.scalars(
            select(ScheduledPost).where(
                ScheduledPost.ad_id == ad.id,
                ScheduledPost.platform.in_(succeeded),
                ScheduledPost.status == "pending",
            )
        )).all()
        for sp in pending:
            sp.status = "posted"
            sp.posted_at = ad.posted_at

        db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="ad.posted",
                        detail={"ad_id": str(ad.id), "platforms": succeeded}))
        await db.commit()
        await db.refresh(ad)

    if failed:
        raise HTTPException(502, f"Posted to {', '.join(succeeded) or 'nothing'}. Failed: " + "; ".join(f"{p} ({msg})" for p, msg in failed.items()))

    return _ad_out(ad)


@router.patch("/{ad_id}", response_model=AdOut)
async def patch_ad(ad_id: uuid.UUID, data: AdPatchIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ad = await db.get(Ad, ad_id)
    if ad is None or ad.company_id != user.company_id:
        raise HTTPException(404, "Ad not found")
    if data.status is not None:
        if data.status not in ("ready", "pending_approval", "approved", "scheduled", "posted"):
            raise HTTPException(422, "Invalid status")
        ad.status = data.status
    if data.favorite is not None:
        ad.favorite = data.favorite
    if data.results is not None:
        ad.results = data.results
        flag_modified(ad, "results")
    await db.commit()
    await db.refresh(ad)
    return _ad_out(ad)


@router.delete("/{ad_id}", status_code=204)
async def delete_ad(ad_id: uuid.UUID, user: User = Depends(require_capability("create_ads")), db: AsyncSession = Depends(get_db)):
    ad = await db.get(Ad, ad_id)
    if ad is None or ad.company_id != user.company_id:
        raise HTTPException(404, "Ad not found")
    # No ON DELETE CASCADE is configured on these foreign keys, so clean up
    # dependent rows first to avoid a foreign-key violation on delete.
    await db.execute(delete(GenerationJob).where(GenerationJob.ad_id == ad.id))
    await db.execute(delete(ScheduledPost).where(ScheduledPost.ad_id == ad.id))
    await db.delete(ad)
    db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="ad.deleted", detail={"ad_id": str(ad_id)}))
    await db.commit()
