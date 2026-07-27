"""Platform-operator routes — entirely separate from the per-company
user/admin system. Auth here is checked directly against
DEVELOPER_EMAIL/DEVELOPER_PASSWORD in .env (see require_developer in
deps.py); nothing in this file ever creates or reads a User row, and no
company's admin can reach any of this regardless of their role or
capabilities — there is no code path that connects the two systems."""
import asyncio
import os
import subprocess
import uuid
from datetime import datetime, timedelta

import httpx
import redis as redis_lib
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func, select, String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.config import settings
from app.database import get_db
from app.deps import require_developer, require_developer_permission
from app.models import Ad, AuditLog, Campaign, Company, CreditLedger, FlaggedContent, GenerationJob, GuardrailRule, ModelConfig, Subscription, User, get_config_row
from app.schemas import (
    AddAssistantHintIn, AddCameraStylePresetIn, AddDeveloperTeamUserIn, AddModelIn, AddPlatformIntegrationIn,
    AddMusicPresetIn, AddTextStylePresetIn, AddThemeTagIn, AddVideoRatioIn, AddVisionModelIn,
    AnalyzeThemeImageIn, AnalyzeThemeImageOut, AssistantHintOut, AssistantSettingsIn, AssistantSettingsOut,
    CameraStylePresetOut, MusicPresetOut, VideoReferencePromptDefaultOut, VideoReferencePromptDefaultIn,
    CompanyAdminOut, DeveloperLoginIn, DeveloperModelOut, DeveloperModelsOut, DeveloperTeamUserOut,
    DeveloperTokenOut, GenerateAllMissingOut, GenerateIntroAudioIn, GenerateTagPromptIn, GenerateTagPromptOut,
    GenerateVideoThemeDraftIn, GenerateVideoThemeDraftOut, GenerateVideoThemeThumbnailIn,
    GenerateVideoThemeThumbnailOut, GuardrailRuleCreateIn, GuardrailRuleOut, ImageGalleryEntryIn,
    ImageThemeEditorIn, ImageThemeEditorOut, MarkupMultiplierIn, MarkupMultiplierOut, MaxExtraUsersIn,
    MaxExtraUsersOut, OpenRouterCatalogModelOut, OpenRouterCreditsOut, PlatformIntegrationOut,
    PlatformOverviewOut, PostRetentionMonthsIn, PostRetentionMonthsOut, RatioUsageOut, RawModelsIn, RawModelsOut,
    RawThemesIn, RawThemesOut, ReorderModelsIn, RetentionMonthsIn, RetentionMonthsOut, SaveVideoThemeIn,
    TextStylePresetOut, ThemeAiSettingsIn, ThemeAiSettingsOut, ThemeThumbnailUploadIn, ThemeThumbnailUploadOut,
    UpdateAssistantHintIn, UpdateCameraStylePresetIn, UpdateDeveloperTeamUserIn, UpdateModelIn,
    UpdateMusicPresetIn, UpdatePlatformIntegrationIn, UpdateTextStylePresetIn, VideoPrepSettingsIn, VideoPrepSettingsOut,
    VideoRatiosOut, VideoThemeOut,
)
from app.security import create_developer_token
from app.services import credits as credit_svc
from app.services import platform_config
from app.services import pricing as pricing_svc
from app.services import retention as retention_svc
from app.services import team_limits as team_limits_svc
from app.services import assistant_hints as assistant_hints_svc
from app.services import developer_team as developer_team_svc
from app.services import theme_ai as theme_ai_svc
from app.services import themes as themes_svc
from app.services import video_prep as video_prep_svc
from app.services import video_ratios as video_ratios_svc
from app.services.guardrails import get_or_seed_global_rules
from app.services.storage import upload_data_url
from app.services.token_crypto import encrypt_token

router = APIRouter(prefix="/developer", tags=["developer"])

# Real, current tier pricing (see scripts/setup_stripe_prices.py) — used
# only for the estimated MRR figure on the overview. If pricing ever
# changes, update both places.
TIER_MONTHLY_USD = {"free": 0, "starter": 29, "growth": 79, "pro": 199}


@router.post("/login", response_model=DeveloperTokenOut)
async def developer_login(data: DeveloperLoginIn, db: AsyncSession = Depends(get_db)):
    # Owner path — plain .env comparison, deliberately: this credential
    # lives alongside JWT_SECRET and STRIPE_SECRET_KEY, which are already
    # the trust boundary for this whole app. No database round-trip.
    if settings.DEVELOPER_EMAIL and settings.DEVELOPER_PASSWORD and data.email == settings.DEVELOPER_EMAIL and data.password == settings.DEVELOPER_PASSWORD:
        return DeveloperTokenOut(access_token=create_developer_token(), is_owner=True, permissions={k: True for k in developer_team_svc.PERMISSION_KEYS})

    # Team-member path — checks developer_team_users. Tried second (not
    # instead of) so the owner login keeps working with zero DB access
    # even if the database is briefly unavailable.
    team_user = await developer_team_svc.authenticate_team_user(db, data.email, data.password)
    if team_user:
        permissions = {**developer_team_svc.DEFAULT_PERMISSIONS, **(team_user.permissions or {})}
        return DeveloperTokenOut(
            access_token=create_developer_token(str(team_user.id), permissions),
            is_owner=False, permissions=permissions,
        )

    raise HTTPException(401, "Invalid developer credentials")


@router.get("/team", response_model=list[DeveloperTeamUserOut])
async def list_developer_team(_: str = Depends(require_developer_permission("team")), db: AsyncSession = Depends(get_db)):
    """Every additional developer team member (never includes the .env
    owner login — that one isn't a database row)."""
    return [DeveloperTeamUserOut(**u) for u in await developer_team_svc.list_team_users(db)]


@router.get("/team/permission-keys")
async def list_developer_permission_keys(_: str = Depends(require_developer)):
    """The full set of grantable sections + human-readable labels, for
    Developer > Team's permission checkboxes — any developer can read
    this (needed just to render their OWN read-only permission list),
    but only /team itself (list/add/edit) requires the "team" permission."""
    return {"keys": developer_team_svc.PERMISSION_KEYS, "labels": developer_team_svc.PERMISSION_LABELS}


@router.post("/team", response_model=DeveloperTeamUserOut)
async def add_developer_team_user(data: AddDeveloperTeamUserIn, _: str = Depends(require_developer_permission("team")), db: AsyncSession = Depends(get_db)):
    try:
        created = await developer_team_svc.create_team_user(db, data.email, data.full_name, data.password, data.permissions)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return DeveloperTeamUserOut(**created)


@router.put("/team/{user_id}", response_model=DeveloperTeamUserOut)
async def update_developer_team_user(user_id: uuid.UUID, data: UpdateDeveloperTeamUserIn, _: str = Depends(require_developer_permission("team")), db: AsyncSession = Depends(get_db)):
    try:
        updated = await developer_team_svc.update_team_user(
            db, user_id, full_name=data.full_name, permissions=data.permissions, status=data.status, password=data.password,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return DeveloperTeamUserOut(**updated)


@router.delete("/team/{user_id}")
async def delete_developer_team_user(user_id: uuid.UUID, _: str = Depends(require_developer_permission("team")), db: AsyncSession = Depends(get_db)):
    try:
        await developer_team_svc.delete_team_user(db, user_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return {"ok": True}


@router.get("/overview", response_model=PlatformOverviewOut)
async def platform_overview(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    total_companies = await db.scalar(select(func.count()).select_from(Company))

    tier_rows = (await db.execute(
        select(Subscription.tier, func.count(func.distinct(Subscription.company_id)))
        .group_by(Subscription.tier)
    )).all()
    companies_by_tier: dict[str, int] = {tier: count for tier, count in tier_rows}

    active_paid = await db.scalar(
        select(func.count()).select_from(Subscription)
        .where(Subscription.tier != "free", Subscription.status == "active")
    )

    estimated_mrr = sum(TIER_MONTHLY_USD.get(tier, 0) * count for tier, count in companies_by_tier.items())

    total_users = await db.scalar(select(func.count()).select_from(User).where(User.status == "active"))
    total_ads = await db.scalar(select(func.count()).select_from(Ad))
    total_campaigns = await db.scalar(select(func.count()).select_from(Campaign))
    flagged_unresolved = await db.scalar(
        select(func.count()).select_from(FlaggedContent).where(FlaggedContent.resolved.is_(False))
    )

    return PlatformOverviewOut(
        total_companies=total_companies or 0,
        companies_by_tier=companies_by_tier,
        active_paid_subscriptions=active_paid or 0,
        estimated_mrr_usd=float(estimated_mrr),
        total_users=total_users or 0,
        total_ads=total_ads or 0,
        total_campaigns=total_campaigns or 0,
        flagged_unresolved_total=flagged_unresolved or 0,
    )


@router.get("/monitoring")
async def platform_monitoring(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """Comprehensive monitoring data for the developer dashboard."""
    now = datetime.utcnow()
    hour_ago   = now - timedelta(hours=1)
    day_ago    = now - timedelta(hours=24)
    week_ago   = now - timedelta(days=7)
    month_ago  = now - timedelta(days=30)
    year_ago   = now - timedelta(days=365)

    # ── Worker Queue ──────────────────────────────────────────────────
    live_jobs = await db.scalar(
        select(func.count()).select_from(GenerationJob)
        .where(GenerationJob.status == "generating")
    )
    queued_jobs = await db.scalar(
        select(func.count()).select_from(GenerationJob)
        .where(GenerationJob.status == "queued")
    )
    wait_rows = (await db.execute(
        select(
            func.avg(
                func.extract("epoch", GenerationJob.finished_at) -
                func.extract("epoch", GenerationJob.created_at)
            )
        ).where(
            GenerationJob.finished_at.isnot(None),
            GenerationJob.created_at >= day_ago,
            GenerationJob.status.in_(["ready", "failed"])
        )
    )).scalar()
    avg_job_duration_s = round(float(wait_rows or 0), 1)

    # Jobs by status last 24h
    status_rows = (await db.execute(
        select(GenerationJob.status, func.count())
        .where(GenerationJob.created_at >= day_ago)
        .group_by(GenerationJob.status)
    )).all()
    jobs_by_status_24h = {s: c for s, c in status_rows}

    # ── Queue depth per hour — last 24 h ─────────────────────────────
    # Approximation: count jobs created per hour as a queue-depth proxy
    _trunc_hour_job = func.date_trunc("hour", GenerationJob.created_at)
    queue_hour_rows = (await db.execute(
        select(
            _trunc_hour_job.label("hour"),
            func.count().label("total"),
            func.sum(case((GenerationJob.status == "generating", 1), else_=0)).label("generating"),
            func.sum(case((GenerationJob.status == "queued",     1), else_=0)).label("queued"),
            func.sum(case((GenerationJob.status == "failed",     1), else_=0)).label("failed"),
        )
        .where(GenerationJob.created_at >= day_ago)
        .group_by(_trunc_hour_job)
        .order_by(_trunc_hour_job)
    )).all()
    queue_per_hour = [
        {
            "hour": r.hour.strftime("%H:%M"),
            "total": r.total,
            "generating": r.generating,
            "queued": r.queued,
            "failed": r.failed,
        }
        for r in queue_hour_rows
    ]

    # ── Job Volume per hour — last 24 h ───────────────────────────────
    # Reuse the same rows — jobs_per_hour is total count per hour
    jobs_per_hour = [{"hour": r.hour.strftime("%H:%M"), "count": r.total} for r in queue_hour_rows]

    # ── Job Volume per day — last 30 days ─────────────────────────────
    _trunc_day_job = func.date_trunc("day", GenerationJob.created_at)
    volume_day_rows = (await db.execute(
        select(_trunc_day_job.label("day"), func.count().label("count"))
        .where(GenerationJob.created_at >= month_ago)
        .group_by(_trunc_day_job)
        .order_by(_trunc_day_job)
    )).all()
    jobs_per_day = [{"date": str(r.day.date()), "count": r.count} for r in volume_day_rows]

    # ── Job Volume per month — last 12 months ─────────────────────────
    _trunc_month_job = func.date_trunc("month", GenerationJob.created_at)
    volume_month_rows = (await db.execute(
        select(_trunc_month_job.label("month"), func.count().label("count"))
        .where(GenerationJob.created_at >= year_ago)
        .group_by(_trunc_month_job)
        .order_by(_trunc_month_job)
    )).all()
    jobs_per_month = [
        {"month": r.month.strftime("%b %Y"), "count": r.count}
        for r in volume_month_rows
    ]

    # Also keep the original 7-day slice for the summary stat
    total_7d = await db.scalar(
        select(func.count()).select_from(GenerationJob)
        .where(GenerationJob.created_at >= week_ago)
    ) or 0
    total_30d = sum(r.count for r in volume_day_rows)

    # Jobs by kind last 30 days (image/video/text)
    video_count = await db.scalar(
        select(func.count()).select_from(GenerationJob)
        .join(Ad, Ad.id == GenerationJob.ad_id)
        .where(GenerationJob.created_at >= month_ago,
               Ad.outputs.op("->")("video").cast(String) == "true")
    ) or 0
    image_count = await db.scalar(
        select(func.count()).select_from(GenerationJob)
        .join(Ad, Ad.id == GenerationJob.ad_id)
        .where(GenerationJob.created_at >= month_ago,
               Ad.outputs.op("->")("image").cast(String) == "true",
               Ad.outputs.op("->")("video").cast(String) != "true")
    ) or 0
    text_count = await db.scalar(
        select(func.count()).select_from(GenerationJob)
        .join(Ad, Ad.id == GenerationJob.ad_id)
        .where(GenerationJob.created_at >= month_ago,
               Ad.outputs.op("->")("image").cast(String) != "true",
               Ad.outputs.op("->")("video").cast(String) != "true")
    ) or 0
    jobs_by_kind_7d = {"text": text_count, "image": image_count, "video": video_count}

    # ── Failure Rate ─────────────────────────────────────────────────
    failed_7d = await db.scalar(
        select(func.count()).select_from(GenerationJob)
        .where(GenerationJob.created_at >= week_ago, GenerationJob.status == "failed")
    ) or 0
    failure_rate_pct = round((failed_7d / total_7d * 100) if total_7d else 0, 1)

    error_rows = (await db.execute(
        select(GenerationJob.model_used, GenerationJob.error, func.count().label("count"))
        .where(
            GenerationJob.created_at >= week_ago,
            GenerationJob.status == "failed",
            GenerationJob.error.isnot(None)
        )
        .group_by(GenerationJob.model_used, GenerationJob.error)
        .order_by(func.count().desc())
        .limit(10)
    )).all()
    top_errors = [{"model": r.model_used, "error": (r.error or "")[:120], "count": r.count} for r in error_rows]

    # ── Active Users ─────────────────────────────────────────────────
    dau = await db.scalar(
        select(func.count(func.distinct(AuditLog.user_id)))
        .where(AuditLog.created_at >= day_ago, AuditLog.user_id.isnot(None))
    ) or 0
    wau = await db.scalar(
        select(func.count(func.distinct(AuditLog.user_id)))
        .where(AuditLog.created_at >= week_ago, AuditLog.user_id.isnot(None))
    ) or 0

    _trunc_day_audit = func.date_trunc("day", AuditLog.created_at)
    dau_rows = (await db.execute(
        select(_trunc_day_audit.label("day"), func.count(func.distinct(AuditLog.user_id)).label("dau"))
        .where(AuditLog.created_at >= week_ago, AuditLog.user_id.isnot(None))
        .group_by(_trunc_day_audit)
        .order_by(_trunc_day_audit)
    )).all()
    dau_per_day = [{"date": str(r.day.date()), "dau": r.dau} for r in dau_rows]

    new_companies_7d = await db.scalar(
        select(func.count()).select_from(Company)
        .where(Company.created_at >= week_ago)
    ) or 0

    # ── Credits & Revenue ────────────────────────────────────────────
    credits_24h = await db.scalar(
        select(func.coalesce(func.sum(func.abs(CreditLedger.delta)), 0))
        .where(CreditLedger.created_at >= day_ago, CreditLedger.delta < 0)
    ) or 0
    credits_7d = await db.scalar(
        select(func.coalesce(func.sum(func.abs(CreditLedger.delta)), 0))
        .where(CreditLedger.created_at >= week_ago, CreditLedger.delta < 0)
    ) or 0

    _trunc_day_credit = func.date_trunc("day", CreditLedger.created_at)
    credits_rows = (await db.execute(
        select(_trunc_day_credit.label("day"), func.coalesce(func.sum(func.abs(CreditLedger.delta)), 0).label("credits"))
        .where(CreditLedger.created_at >= week_ago, CreditLedger.delta < 0)
        .group_by(_trunc_day_credit)
        .order_by(_trunc_day_credit)
    )).all()
    credits_per_day = [{"date": str(r.day.date()), "credits": int(r.credits)} for r in credits_rows]

    tier_credit_rows = (await db.execute(
        select(Subscription.tier, func.coalesce(func.sum(func.abs(CreditLedger.delta)), 0).label("credits"))
        .join(CreditLedger, CreditLedger.company_id == Subscription.company_id)
        .where(CreditLedger.created_at >= week_ago, CreditLedger.delta < 0)
        .group_by(Subscription.tier)
    )).all()
    credits_by_tier_7d = {r.tier: int(r.credits) for r in tier_credit_rows}

    # ── Storage estimate ─────────────────────────────────────────────
    total_ads_with_image = await db.scalar(
        select(func.count()).select_from(Ad)
        .where(Ad.results.isnot(None))
    ) or 0
    estimated_storage_gb = round((total_ads_with_image * 0.5) / 1024, 2)

    return {
        # Worker queue
        "live_jobs": live_jobs or 0,
        "queued_jobs": queued_jobs or 0,
        "avg_job_duration_s": avg_job_duration_s,
        "jobs_by_status_24h": jobs_by_status_24h,
        "queue_per_hour": queue_per_hour,        # NEW — 24h hourly breakdown
        # Volume
        "jobs_per_hour": jobs_per_hour,          # NEW — 24h hourly job count
        "jobs_per_day": jobs_per_day,            # now 30 days
        "jobs_per_month": jobs_per_month,        # NEW — 12 months
        "jobs_by_kind_7d": jobs_by_kind_7d,
        "total_jobs_7d": total_7d,
        "total_jobs_30d": total_30d,             # NEW
        # Failures
        "failed_jobs_7d": failed_7d,
        "failure_rate_pct": failure_rate_pct,
        "top_errors": top_errors,
        # Users
        "dau": dau,
        "wau": wau,
        "dau_per_day": dau_per_day,
        "new_companies_7d": new_companies_7d,
        # Credits
        "credits_consumed_24h": int(credits_24h),
        "credits_consumed_7d": int(credits_7d),
        "credits_per_day": credits_per_day,
        "credits_by_tier_7d": credits_by_tier_7d,
        # Storage
        "estimated_storage_gb": estimated_storage_gb,
    }




    # ── Worker Queue ──────────────────────────────────────────────────
    # Jobs currently generating
    live_jobs = await db.scalar(
        select(func.count()).select_from(GenerationJob)
        .where(GenerationJob.status == "generating")
    )
    # Jobs queued but not yet started (queued status)
    queued_jobs = await db.scalar(
        select(func.count()).select_from(GenerationJob)
        .where(GenerationJob.status == "queued")
    )
    # Average queue wait time last 24h (created_at → finished_at for quick jobs as proxy)
    wait_rows = (await db.execute(
        select(
            func.avg(
                func.extract("epoch", GenerationJob.finished_at) -
                func.extract("epoch", GenerationJob.created_at)
            )
        ).where(
            GenerationJob.finished_at.isnot(None),
            GenerationJob.created_at >= day_ago,
            GenerationJob.status.in_(["ready", "failed"])
        )
    )).scalar()
    avg_job_duration_s = round(float(wait_rows or 0), 1)

    # Jobs by status (last 24h)
    status_rows = (await db.execute(
        select(GenerationJob.status, func.count())
        .where(GenerationJob.created_at >= day_ago)
        .group_by(GenerationJob.status)
    )).all()
    jobs_by_status_24h = {s: c for s, c in status_rows}

    # ── Job Volume (last 7 days, per day) ────────────────────────────
    _trunc_day_job = func.date_trunc("day", GenerationJob.created_at)
    volume_rows = (await db.execute(
        select(_trunc_day_job.label("day"), func.count().label("count"))
        .where(GenerationJob.created_at >= week_ago)
        .group_by(_trunc_day_job)
        .order_by(_trunc_day_job)
    )).all()
    jobs_per_day = [{"date": str(r.day.date()), "count": r.count} for r in volume_rows]

    # Jobs by kind last 7 days (image/video/text)
    # Count jobs by ad content type using JSONB operators to avoid GROUP BY issues
    video_count = await db.scalar(
        select(func.count()).select_from(GenerationJob)
        .join(Ad, Ad.id == GenerationJob.ad_id)
        .where(GenerationJob.created_at >= week_ago,
               Ad.outputs.op("->")("video").cast(String) == "true")
    ) or 0
    image_count = await db.scalar(
        select(func.count()).select_from(GenerationJob)
        .join(Ad, Ad.id == GenerationJob.ad_id)
        .where(GenerationJob.created_at >= week_ago,
               Ad.outputs.op("->")("image").cast(String) == "true",
               Ad.outputs.op("->")("video").cast(String) != "true")
    ) or 0
    text_count = await db.scalar(
        select(func.count()).select_from(GenerationJob)
        .join(Ad, Ad.id == GenerationJob.ad_id)
        .where(GenerationJob.created_at >= week_ago,
               Ad.outputs.op("->")("image").cast(String) != "true",
               Ad.outputs.op("->")("video").cast(String) != "true")
    ) or 0
    jobs_by_kind_7d = {"text": text_count, "image": image_count, "video": video_count}

    # ── Failure Rate ─────────────────────────────────────────────────
    total_7d = await db.scalar(
        select(func.count()).select_from(GenerationJob)
        .where(GenerationJob.created_at >= week_ago)
    ) or 0
    failed_7d = await db.scalar(
        select(func.count()).select_from(GenerationJob)
        .where(GenerationJob.created_at >= week_ago, GenerationJob.status == "failed")
    ) or 0
    failure_rate_pct = round((failed_7d / total_7d * 100) if total_7d else 0, 1)

    # Top error messages last 7d
    error_rows = (await db.execute(
        select(GenerationJob.model_used, GenerationJob.error, func.count().label("count"))
        .where(
            GenerationJob.created_at >= week_ago,
            GenerationJob.status == "failed",
            GenerationJob.error.isnot(None)
        )
        .group_by(GenerationJob.model_used, GenerationJob.error)
        .order_by(func.count().desc())
        .limit(10)
    )).all()
    top_errors = [{"model": r.model_used, "error": (r.error or "")[:120], "count": r.count} for r in error_rows]

    # ── Active Users ─────────────────────────────────────────────────
    dau = await db.scalar(
        select(func.count(func.distinct(AuditLog.user_id)))
        .where(AuditLog.created_at >= day_ago, AuditLog.user_id.isnot(None))
    ) or 0
    wau = await db.scalar(
        select(func.count(func.distinct(AuditLog.user_id)))
        .where(AuditLog.created_at >= week_ago, AuditLog.user_id.isnot(None))
    ) or 0

    # DAU per day last 7 days
    _trunc_day_audit = func.date_trunc("day", AuditLog.created_at)
    dau_rows = (await db.execute(
        select(_trunc_day_audit.label("day"), func.count(func.distinct(AuditLog.user_id)).label("dau"))
        .where(AuditLog.created_at >= week_ago, AuditLog.user_id.isnot(None))
        .group_by(_trunc_day_audit)
        .order_by(_trunc_day_audit)
    )).all()
    dau_per_day = [{"date": str(r.day.date()), "dau": r.dau} for r in dau_rows]

    # New companies last 7 days
    new_companies_7d = await db.scalar(
        select(func.count()).select_from(Company)
        .where(Company.created_at >= week_ago)
    ) or 0

    # ── Credits & Revenue ────────────────────────────────────────────
    credits_24h = await db.scalar(
        select(func.coalesce(func.sum(func.abs(CreditLedger.delta)), 0))
        .where(CreditLedger.created_at >= day_ago, CreditLedger.delta < 0)
    ) or 0
    credits_7d = await db.scalar(
        select(func.coalesce(func.sum(func.abs(CreditLedger.delta)), 0))
        .where(CreditLedger.created_at >= week_ago, CreditLedger.delta < 0)
    ) or 0

    # Credits consumed per day last 7 days
    _trunc_day_credit = func.date_trunc("day", CreditLedger.created_at)
    credits_rows = (await db.execute(
        select(_trunc_day_credit.label("day"), func.coalesce(func.sum(func.abs(CreditLedger.delta)), 0).label("credits"))
        .where(CreditLedger.created_at >= week_ago, CreditLedger.delta < 0)
        .group_by(_trunc_day_credit)
        .order_by(_trunc_day_credit)
    )).all()
    credits_per_day = [{"date": str(r.day.date()), "credits": int(r.credits)} for r in credits_rows]

    # Credits by tier
    tier_credit_rows = (await db.execute(
        select(Subscription.tier, func.coalesce(func.sum(func.abs(CreditLedger.delta)), 0).label("credits"))
        .join(CreditLedger, CreditLedger.company_id == Subscription.company_id)
        .where(CreditLedger.created_at >= week_ago, CreditLedger.delta < 0)
        .group_by(Subscription.tier)
    )).all()
    credits_by_tier_7d = {r.tier: int(r.credits) for r in tier_credit_rows}

    # ── Storage estimate ─────────────────────────────────────────────
    total_ads_with_image = await db.scalar(
        select(func.count()).select_from(Ad)
        .where(Ad.results.isnot(None))
    ) or 0
    # Rough estimate: avg image ~500KB, avg video ~15MB
    image_ads = image_count  # from above (7d)
    video_ads = video_count
    estimated_storage_gb = round(
        (total_ads_with_image * 0.5) / 1024, 2  # all time, ~0.5MB per ad result
    )

    return {
        # Worker queue
        "live_jobs": live_jobs or 0,
        "queued_jobs": queued_jobs or 0,
        "avg_job_duration_s": avg_job_duration_s,
        "jobs_by_status_24h": jobs_by_status_24h,
        # Volume
        "jobs_per_day": jobs_per_day,
        "jobs_by_kind_7d": jobs_by_kind_7d,
        "total_jobs_7d": total_7d,
        # Failures
        "failed_jobs_7d": failed_7d,
        "failure_rate_pct": failure_rate_pct,
        "top_errors": top_errors,
        # Users
        "dau": dau,
        "wau": wau,
        "dau_per_day": dau_per_day,
        "new_companies_7d": new_companies_7d,
        # Credits
        "credits_consumed_24h": int(credits_24h),
        "credits_consumed_7d": int(credits_7d),
        "credits_per_day": credits_per_day,
        "credits_by_tier_7d": credits_by_tier_7d,
        # Storage
        "estimated_storage_gb": estimated_storage_gb,
    }




# ── System logs ───────────────────────────────────────────────────────────────

@router.get("/logs")
async def query_logs(
    service: str | None = None,
    level: str | None = None,
    date_from: str | None = None,   # YYYY-MM-DD
    date_to: str | None = None,     # YYYY-MM-DD
    search: str | None = None,      # substring search in message
    page: int = 1,
    page_size: int = 200,
    _: str = Depends(require_developer),
    db: AsyncSession = Depends(get_db),
):
    """Query system_logs with filters. Returns paginated rows plus
    available services and dates for the filter UI."""
    from app.models import SystemLog
    import re as _re

    q = select(SystemLog).order_by(SystemLog.created_at.desc())

    if service:
        q = q.where(SystemLog.service == service)
    if level:
        q = q.where(SystemLog.level == level)
    if date_from:
        try:
            dt_from = datetime.strptime(date_from, "%Y-%m-%d")
            q = q.where(SystemLog.created_at >= dt_from)
        except ValueError:
            raise HTTPException(422, "date_from must be YYYY-MM-DD")
    if date_to:
        try:
            dt_to = datetime.strptime(date_to, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
            q = q.where(SystemLog.created_at <= dt_to)
        except ValueError:
            raise HTTPException(422, "date_to must be YYYY-MM-DD")
    if search:
        q = q.where(SystemLog.message.ilike(f"%{search}%"))

    # Total count for pagination
    count_q = select(func.count()).select_from(q.subquery())
    total = await db.scalar(count_q) or 0

    # Page
    offset = (page - 1) * page_size
    rows = (await db.execute(q.offset(offset).limit(page_size))).scalars().all()

    # Available services (for filter dropdown)
    service_rows = (await db.execute(
        select(SystemLog.service).distinct().order_by(SystemLog.service)
    )).scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "rows": [
            {
                "id": r.id,
                "service": r.service,
                "level": r.level,
                "logger_name": r.logger_name,
                "message": r.message,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
        "services": list(service_rows),
    }


@router.get("/logs/download")
async def download_logs(
    service: str | None = None,
    level: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    search: str | None = None,
    _: str = Depends(require_developer),
    db: AsyncSession = Depends(get_db),
):
    """Download filtered logs as a plain .log file."""
    from app.models import SystemLog
    from fastapi.responses import StreamingResponse

    q = select(SystemLog).order_by(SystemLog.created_at.asc())
    if service:
        q = q.where(SystemLog.service == service)
    if level:
        q = q.where(SystemLog.level == level)
    if date_from:
        try:
            q = q.where(SystemLog.created_at >= datetime.strptime(date_from, "%Y-%m-%d"))
        except ValueError:
            raise HTTPException(422, "date_from must be YYYY-MM-DD")
    if date_to:
        try:
            q = q.where(SystemLog.created_at <= datetime.strptime(date_to, "%Y-%m-%d").replace(hour=23, minute=59, second=59))
        except ValueError:
            raise HTTPException(422, "date_to must be YYYY-MM-DD")
    if search:
        q = q.where(SystemLog.message.ilike(f"%{search}%"))

    rows = (await db.execute(q.limit(50_000))).scalars().all()

    parts = [f"service={service or 'all'} level={level or 'all'} date={date_from or '?'} to {date_to or '?'}\n"]
    parts += [
        f"{r.created_at.strftime('%Y-%m-%d %H:%M:%S')} [{r.service}] [{r.level}] {r.logger_name} — {r.message}\n"
        for r in rows
    ]
    content = "".join(parts)

    svc_part = f"-{service}" if service else ""
    date_part = f"-{date_from}" if date_from else ""
    filename = f"nivaspark-logs{svc_part}{date_part}.log"

    def _iter():
        yield content.encode("utf-8")

    return StreamingResponse(
        _iter(),
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/logs/retention")
async def get_log_retention(_: str = Depends(require_developer_permission("settings")), db: AsyncSession = Depends(get_db)):
    from app.services.retention import get_log_retention_days
    return {"log_retention_days": await get_log_retention_days(db)}


@router.put("/logs/retention")
async def set_log_retention(body: dict, _: str = Depends(require_developer_permission("settings")), db: AsyncSession = Depends(get_db)):
    from app.services.retention import set_log_retention_days
    days = int(body.get("log_retention_days", 30))
    if days < 1 or days > 365:
        raise HTTPException(422, "log_retention_days must be 1–365")
    await set_log_retention_days(db, days)
    return {"log_retention_days": days}


@router.get("/openrouter-credits", response_model=OpenRouterCreditsOut)
async def get_openrouter_credits(_: str = Depends(require_developer_permission("models"))):
    """Live balance on the actual OpenRouter account every company's
    image/video generation draws from — this is what a 402 "Insufficient
    credits" error means when a company's generation fails, so it's
    worth being able to see and manage from here rather than only
    discovering it via a failed generation."""
    if not settings.OPENROUTER_API_KEY:
        raise HTTPException(503, "OPENROUTER_API_KEY is not configured on this server.")
    try:
        resp = httpx.get(
            f"{settings.OPENROUTER_BASE_URL}/credits",
            headers={"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}"},
            timeout=15,
        )
    except httpx.RequestError as exc:
        raise HTTPException(502, f"Could not reach OpenRouter: {exc}")
    if resp.status_code >= 400:
        raise HTTPException(502, f"OpenRouter returned {resp.status_code}: {resp.text[:300]}")
    data = resp.json().get("data", {})
    total_credits = float(data.get("total_credits", 0) or 0)
    total_usage = float(data.get("total_usage", 0) or 0)
    return OpenRouterCreditsOut(total_credits=total_credits, total_usage=total_usage, remaining=total_credits - total_usage)


@router.get("/openrouter-catalog", response_model=list[OpenRouterCatalogModelOut])
async def browse_openrouter_catalog(kind: str, _: str = Depends(require_developer_permission("models"))):
    """Live browse of OpenRouter's own model catalog, filtered to image
    or video generation models — powers the 'Fetch from OpenRouter'
    popup in Developer > Models, so adding a model means clicking a real
    entry from the actual current catalog instead of hand-typing a slug
    (which is exactly how two wrong-slug bugs happened before).

    FIXED 2026-07-13: the first version of this hit the generic
    GET /api/v1/models and tried to filter client-side by an
    output_modalities field — that generic endpoint simply does not
    list video models at all (confirmed via OpenRouter's own
    announcement and multiple independent integration reports of this
    exact mistake), which is why every video fetch came back empty.
    Video and image models each have their OWN dedicated catalog
    endpoint, and this now calls the right one for each:
      video: GET /api/v1/videos/models   (pricing_skus included inline)
      image: GET /api/v1/images/models   (no inline pricing per OpenRouter's
             own docs — would need a further per-model call to
             /api/v1/images/models/{id}/endpoints for that; skipped
             here to keep this to one request per fetch, so image
             pricing shows as unavailable and is set manually)

    Parsing is still deliberately defensive (every field optional-with-
    fallback) since even the correct endpoint's exact field names could
    shift — if something's missing, the developer just fills it in
    manually in the Add form."""
    if kind not in ("image", "video"):
        raise HTTPException(422, "kind must be image or video")
    if not settings.OPENROUTER_API_KEY:
        raise HTTPException(503, "OPENROUTER_API_KEY is not configured on this server.")

    url = f"{settings.OPENROUTER_BASE_URL}/videos/models" if kind == "video" else f"{settings.OPENROUTER_BASE_URL}/images/models"
    try:
        resp = httpx.get(url, headers={"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}"}, timeout=20)
    except httpx.RequestError as exc:
        raise HTTPException(502, f"Could not reach OpenRouter: {exc}")
    if resp.status_code >= 400:
        raise HTTPException(502, f"OpenRouter returned {resp.status_code}: {resp.text[:300]}")

    body = resp.json()
    # Defensive about the wrapper shape — OpenRouter's own docs show the
    # video endpoint wrapped in {"data": [...]}, but example payloads for
    # the newer image endpoint suggest it may return a bare list; handle
    # both rather than assume.
    rows = body.get("data", []) if isinstance(body, dict) else (body if isinstance(body, list) else [])

    out: list[OpenRouterCatalogModelOut] = []
    for m in rows:
        pricing_skus = m.get("pricing_skus") or {}

        def _price(*keys: str) -> float | None:
            for key in keys:
                raw = pricing_skus.get(key)
                if raw is None:
                    continue
                try:
                    v = float(raw)
                    if v > 0:
                        return v
                except (TypeError, ValueError):
                    continue
            return None

        raw_resolutions = m.get("supported_resolutions")
        if not raw_resolutions:
            params = m.get("supported_parameters") or {}
            res_param = params.get("resolution") or {}
            raw_resolutions = res_param.get("values")
        resolutions = [str(r) for r in raw_resolutions] if isinstance(raw_resolutions, list) and raw_resolutions else None

        raw_max = m.get("max_video_duration") or m.get("max_duration_seconds")
        try:
            max_duration = int(raw_max) if raw_max else None
        except (TypeError, ValueError):
            max_duration = None

        out.append(OpenRouterCatalogModelOut(
            slug=m.get("id") or m.get("slug") or "",
            name=m.get("name") or m.get("id") or "",
            description=(m.get("description") or "")[:300] or None,
            price_per_second_usd=_price("per-video-second", "video", "per_second") if kind == "video" else None,
            price_per_image_usd=None,  # not included in the list response for images — fill in manually
            resolutions=resolutions,
            max_duration=max_duration if kind == "video" else None,
        ))
    return out


@router.get("/companies", response_model=list[CompanyAdminOut])
async def list_companies(_: str = Depends(require_developer_permission("companies")), db: AsyncSession = Depends(get_db)):
    companies = (await db.scalars(select(Company).order_by(Company.created_at.desc()))).all()
    if not companies:
        return []
    company_ids = [c.id for c in companies]

    subs = (await db.execute(
        select(Subscription.company_id, Subscription.tier, Subscription.status, Subscription.cancel_at_period_end)
        .where(Subscription.company_id.in_(company_ids))
        .order_by(Subscription.created_at.desc())
    )).all()
    latest_sub: dict[uuid.UUID, tuple] = {}
    for company_id, tier, status, cancel_flag in subs:
        if company_id not in latest_sub:  # first row per company_id is the latest, since ordered desc
            latest_sub[company_id] = (tier, status, cancel_flag)

    credit_rows = (await db.execute(
        select(CreditLedger.company_id, func.coalesce(func.sum(CreditLedger.delta), 0))
        .where(CreditLedger.company_id.in_(company_ids)).group_by(CreditLedger.company_id)
    )).all()
    credits_by_company = {cid: total for cid, total in credit_rows}

    user_rows = (await db.execute(
        select(User.company_id, func.count()).where(User.company_id.in_(company_ids)).group_by(User.company_id)
    )).all()
    users_by_company = {cid: count for cid, count in user_rows}

    ad_rows = (await db.execute(
        select(Ad.company_id, func.count()).where(Ad.company_id.in_(company_ids)).group_by(Ad.company_id)
    )).all()
    ads_by_company = {cid: count for cid, count in ad_rows}

    out = []
    for c in companies:
        tier, status, cancel_flag = latest_sub.get(c.id, ("free", "active", False))
        out.append(CompanyAdminOut(
            id=c.id, name=c.name, tier=tier, subscription_status=status, cancel_at_period_end=cancel_flag,
            credits_balance=credits_by_company.get(c.id, 0),
            user_count=users_by_company.get(c.id, 0),
            ads_total=ads_by_company.get(c.id, 0),
            created_at=c.created_at,
        ))
    return out


@router.get("/models", response_model=DeveloperModelsOut)
async def get_global_models(_: str = Depends(require_developer_permission("models")), db: AsyncSession = Depends(get_db)):
    """The full model list WITH real model slugs — this is the only
    place they're ever exposed; the company-facing endpoint
    (/ads/available-models) never includes them at all."""
    models = await credit_svc.get_available_models(db)
    return DeveloperModelsOut(
        text=[DeveloperModelOut(**m) for m in models["text"]],
        image=[DeveloperModelOut(**m) for m in models["image"]],
        video=[DeveloperModelOut(**m) for m in models["video"]],
    )


async def _save_models(db: AsyncSession, models: dict) -> None:
    row = await get_config_row(db, "models")
    config = dict(row.config or {})
    config["image"] = models["image"]
    config["video"] = models["video"]
    if "text" in models:
        config["text"] = models["text"]
    row.config = config
    flag_modified(row, "config")
    await db.commit()


@router.post("/models", response_model=DeveloperModelsOut, status_code=201)
async def add_model(data: AddModelIn, _: str = Depends(require_developer_permission("models")), db: AsyncSession = Depends(get_db)):
    """Adds a new model to the open-ended list for a kind — no fixed
    count anymore (replaces the old low/medium/best/super tier system);
    add as many as you want."""
    models = await credit_svc.get_available_models(db)
    new_id = f"{data.kind}-{uuid.uuid4().hex[:8]}"
    entry = {"id": new_id, "label": data.label, "model": data.model, "credits": data.credits}
    if data.pricing is not None:
        entry["pricing"] = data.pricing
    if data.kind == "video":
        entry["min_duration"] = data.min_duration or 4
        entry["max_duration"] = data.max_duration or 15
        if data.duration_options:
            entry["duration_options"] = data.duration_options
        if data.resolutions:
            entry["resolutions"] = data.resolutions
        entry["supports_audio"] = data.supports_audio
        entry["supports_last_frame"] = data.supports_last_frame
        if data.price_per_second_usd is not None:
            entry["price_per_second_usd"] = data.price_per_second_usd
    models[data.kind] = [*models[data.kind], entry]
    await _save_models(db, models)
    return DeveloperModelsOut(text=[DeveloperModelOut(**m) for m in models["text"]], image=[DeveloperModelOut(**m) for m in models["image"]], video=[DeveloperModelOut(**m) for m in models["video"]])


@router.put("/models/reorder", response_model=DeveloperModelsOut)
async def reorder_models(data: ReorderModelsIn, _: str = Depends(require_developer_permission("models")), db: AsyncSession = Depends(get_db)):
    """Sets the display order for one kind's model list — the SAME order
    then shows in Create Ad's dropdown, since both read this same
    stored list in sequence."""
    models = await credit_svc.get_available_models(db)
    current = models[data.kind]
    by_id = {m["id"]: m for m in current}
    if set(data.ordered_ids) != set(by_id.keys()):
        raise HTTPException(422, "ordered_ids must contain exactly the current set of model ids for this kind — nothing added or removed, just reordered.")
    models[data.kind] = [by_id[i] for i in data.ordered_ids]
    await _save_models(db, models)
    return DeveloperModelsOut(text=[DeveloperModelOut(**m) for m in models["text"]], image=[DeveloperModelOut(**m) for m in models["image"]], video=[DeveloperModelOut(**m) for m in models["video"]])


@router.get("/models/raw", response_model=RawModelsOut)
async def get_models_raw(_: str = Depends(require_developer_permission("models")), db: AsyncSession = Depends(get_db)):
    """The entire text/image/video model list as one JSON blob, exactly
    as stored — for bulk editing in one shot instead of one field at a
    time through the form UI. Addresses the real pain of a pricing JSON
    (or any other field) silently not sticking through the piecemeal
    edit form: edit and save the WHOLE structure atomically here
    instead, and there's nothing left to partially apply."""
    models = await credit_svc.get_available_models(db)
    return RawModelsOut(models=models)


@router.put("/models/raw", response_model=DeveloperModelsOut)
async def update_models_raw(data: RawModelsIn, _: str = Depends(require_developer_permission("models")), db: AsyncSession = Depends(get_db)):
    """Replaces the ENTIRE model list at once. Validates structurally
    (every entry must be a valid DeveloperModelOut shape, ids unique
    within each kind) before saving anything — a malformed paste
    rejects cleanly with a specific error rather than partially
    corrupting the stored list."""
    if set(data.models.keys()) != {"text", "image", "video"}:
        raise HTTPException(422, "Must have exactly three top-level keys: text, image, video.")
    validated: dict[str, list[dict]] = {}
    for kind, entries in data.models.items():
        if not isinstance(entries, list) or len(entries) == 0:
            raise HTTPException(422, f'"{kind}" must be a non-empty list — Create Ad needs at least one option per kind to function.')
        seen_ids = set()
        clean_entries = []
        for i, entry in enumerate(entries):
            try:
                validated_entry = DeveloperModelOut(**entry)
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(422, f'"{kind}" entry #{i + 1} is malformed: {exc}')
            if validated_entry.id in seen_ids:
                raise HTTPException(422, f'"{kind}" has a duplicate id "{validated_entry.id}" — every entry needs a unique id within its kind.')
            seen_ids.add(validated_entry.id)
            clean_entries.append(validated_entry.model_dump(exclude_none=True))
        validated[kind] = clean_entries
    await _save_models(db, validated)
    return DeveloperModelsOut(text=[DeveloperModelOut(**m) for m in validated["text"]], image=[DeveloperModelOut(**m) for m in validated["image"]], video=[DeveloperModelOut(**m) for m in validated["video"]])


@router.get("/themes", response_model=RawThemesOut)
async def get_themes(_: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    """Create Ad's Text Theme Reference chips + Image Theme Reference
    gallery, exactly as stored — bulk-edited as one JSON blob, same
    pattern as /models/raw above."""
    return RawThemesOut(themes=await themes_svc.get_themes(db))


@router.put("/themes", response_model=RawThemesOut)
async def update_themes(data: RawThemesIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    """Replaces the ENTIRE themes blob at once. Validates structurally
    before saving anything, same all-or-nothing behavior as /models/raw:
    a malformed paste rejects cleanly instead of partially corrupting
    what's stored (and instantly appearing broken in every company's
    Create Ad)."""
    required_keys = {"image_themes", "text_themes", "style_tags", "category_tags"}
    if set(data.themes.keys()) != required_keys:
        raise HTTPException(422, f"Must have exactly these top-level keys: {', '.join(sorted(required_keys))}.")

    style_tags = data.themes["style_tags"]
    category_tags = data.themes["category_tags"]
    if not isinstance(style_tags, list) or not all(isinstance(t, str) for t in style_tags):
        raise HTTPException(422, '"style_tags" must be a list of strings.')
    if not isinstance(category_tags, list) or not all(isinstance(t, str) for t in category_tags):
        raise HTTPException(422, '"category_tags" must be a list of strings.')

    text_themes = data.themes["text_themes"]
    if not isinstance(text_themes, list) or len(text_themes) == 0:
        raise HTTPException(422, '"text_themes" must be a non-empty list — Create Ad needs at least one option.')
    seen = set()
    for i, t in enumerate(text_themes):
        for field in ("id", "label", "scene_prompt", "placement_prompt"):
            if not t.get(field):
                raise HTTPException(422, f'"text_themes" entry #{i + 1} is missing required field "{field}".')
        if t["id"] in seen:
            raise HTTPException(422, f'"text_themes" has a duplicate id "{t["id"]}".')
        seen.add(t["id"])
        t.setdefault("style_tags", [])
        t.setdefault("category_tags", [])

    image_themes = data.themes["image_themes"]
    if not isinstance(image_themes, list):
        raise HTTPException(422, '"image_themes" must be a list (can be empty while you\'re still building it out).')
    seen = set()
    for i, t in enumerate(image_themes):
        for field in ("id", "label", "base_prompt"):
            if not t.get(field):
                raise HTTPException(422, f'"image_themes" entry #{i + 1} is missing required field "{field}".')
        if t["id"] in seen:
            raise HTTPException(422, f'"image_themes" has a duplicate id "{t["id"]}".')
        seen.add(t["id"])
        t.setdefault("thumbnail", "")
        t.setdefault("style_tags", [])
        t.setdefault("category_tags", [])
        text_fields = t.setdefault("text_fields", [])
        if not isinstance(text_fields, list):
            raise HTTPException(422, f'"image_themes" entry #{i + 1}: "text_fields" must be a list.')
        for j, f in enumerate(text_fields):
            for field in ("key", "label"):
                if not f.get(field):
                    raise HTTPException(422, f'"image_themes" entry #{i + 1}, text_fields #{j + 1} is missing required field "{field}".')
            f.setdefault("placeholder", "")
            f.setdefault("style_hint", "")
            f.setdefault("default_position", "top-left")

    saved = await themes_svc.set_themes(db, {
        "image_themes": image_themes, "text_themes": text_themes,
        "style_tags": style_tags, "category_tags": category_tags,
    })
    return RawThemesOut(themes=saved)


@router.post("/themes/thumbnail", response_model=ThemeThumbnailUploadOut)
async def upload_theme_thumbnail(data: ThemeThumbnailUploadIn, _: str = Depends(require_developer_permission("themes"))):
    """Uploads a thumbnail image directly — used inline by the Image Theme
    tab's per-tag editor (pick a file, it uploads and fills the thumbnail
    right there; no separate JSON paste step)."""
    try:
        url = upload_data_url(data.image, prefix="theme-thumbnails")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Could not process that image: {exc}")
    return ThemeThumbnailUploadOut(url=url)


@router.get("/themes/image-theme", response_model=ImageThemeEditorOut)
async def get_image_theme_editor(_: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    """Powers the Image Theme tab's fully visual editor — every style tag
    and every product-category tag, each with its own editable prompt (and,
    for the image-reference variant, its own thumbnail). No JSON shown."""
    return ImageThemeEditorOut(**await themes_svc.get_image_theme_editor(db))


@router.put("/themes/image-theme", response_model=ImageThemeEditorOut)
async def update_image_theme_editor(data: ImageThemeEditorIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    """Saves the whole Image Theme editor state at once — still one atomic
    write under the hood (same ModelConfig blob), but the developer never
    sees or edits raw JSON; the frontend sends this after each field edit."""
    for section_name, section in (("text_for_image", data.text_for_image), ("image_for_image", data.image_for_image)):
        if set(section.keys()) != {"style", "product"}:
            raise HTTPException(422, f'"{section_name}" must have exactly two keys: "style" and "product".')
        for axis_name, axis in section.items():
            if not isinstance(axis, dict):
                raise HTTPException(422, f'"{section_name}.{axis_name}" must be an object keyed by tag name.')
    return ImageThemeEditorOut(**await themes_svc.set_image_theme_editor(db, data.text_for_image, data.image_for_image))


@router.post("/themes/tags", response_model=ImageThemeEditorOut)
async def add_theme_tag(data: AddThemeTagIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    """Adds a brand-new Style or Product Category tag — it shows up with an
    empty prompt slot immediately, ready to fill in."""
    if data.axis not in ("style", "category"):
        raise HTTPException(422, 'axis must be "style" or "category".')
    return ImageThemeEditorOut(**await themes_svc.add_theme_tag(db, data.axis, data.tag.strip()))


@router.get("/themes/text-style-presets", response_model=list[TextStylePresetOut])
async def list_text_style_presets(_: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    """Text-overlay style presets (font style, text color, accent color,
    size) for the Headline/Discount badge/Body fields — "Standard (fits
    the image)" is the default no-override option and can't be deleted."""
    return [TextStylePresetOut(**p) for p in await themes_svc.get_text_style_presets(db)]


@router.post("/themes/text-style-presets", response_model=list[TextStylePresetOut])
async def add_text_style_preset(data: AddTextStylePresetIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    presets = await themes_svc.add_text_style_preset(db, data.label, data.font_style, data.text_color, data.accent_color, data.size)
    return [TextStylePresetOut(**p) for p in presets]


@router.put("/themes/text-style-presets/{preset_id}", response_model=list[TextStylePresetOut])
async def update_text_style_preset(preset_id: str, data: UpdateTextStylePresetIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    try:
        presets = await themes_svc.update_text_style_preset(db, preset_id, data.label, data.font_style, data.text_color, data.accent_color, data.size)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return [TextStylePresetOut(**p) for p in presets]


@router.delete("/themes/text-style-presets/{preset_id}", response_model=list[TextStylePresetOut])
async def delete_text_style_preset(preset_id: str, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    try:
        presets = await themes_svc.delete_text_style_preset(db, preset_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return [TextStylePresetOut(**p) for p in presets]


# --- Camera style presets (Developer > Themes > Camera Styles tab) ---

@router.get("/themes/camera-style-presets", response_model=list[CameraStylePresetOut])
async def list_camera_style_presets(_: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    return [CameraStylePresetOut(**p) for p in await themes_svc.get_camera_style_presets(db)]


@router.post("/themes/camera-style-presets", response_model=list[CameraStylePresetOut])
async def add_camera_style_preset(data: AddCameraStylePresetIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    presets = await themes_svc.add_camera_style_preset(db, data.label, data.prompt_fragment)
    return [CameraStylePresetOut(**p) for p in presets]


@router.put("/themes/camera-style-presets/{preset_id}", response_model=list[CameraStylePresetOut])
async def update_camera_style_preset(preset_id: str, data: UpdateCameraStylePresetIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    try:
        presets = await themes_svc.update_camera_style_preset(db, preset_id, data.label, data.prompt_fragment)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return [CameraStylePresetOut(**p) for p in presets]


@router.delete("/themes/camera-style-presets/{preset_id}", response_model=list[CameraStylePresetOut])
async def delete_camera_style_preset(preset_id: str, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    try:
        presets = await themes_svc.delete_camera_style_preset(db, preset_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return [CameraStylePresetOut(**p) for p in presets]


# --- Video reference prompt default (Developer > Themes > Camera Styles tab) ---

@router.get("/themes/video-reference-prompt-default", response_model=VideoReferencePromptDefaultOut)
async def get_video_reference_prompt_default(_: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    return VideoReferencePromptDefaultOut(prompt=await themes_svc.get_video_reference_prompt_default(db))


@router.put("/themes/video-reference-prompt-default", response_model=VideoReferencePromptDefaultOut)
async def set_video_reference_prompt_default(data: VideoReferencePromptDefaultIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    prompt = await themes_svc.set_video_reference_prompt_default(db, data.prompt)
    return VideoReferencePromptDefaultOut(prompt=prompt)


# --- Background music presets (Developer > Themes > Music Presets tab) ---

@router.get("/themes/music-presets", response_model=list[MusicPresetOut])
async def list_music_presets(_: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    return [MusicPresetOut(**p) for p in await themes_svc.get_music_presets(db)]


@router.post("/themes/music-presets", response_model=list[MusicPresetOut])
async def add_music_preset(data: AddMusicPresetIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    presets = await themes_svc.add_music_preset(db, data.label, data.description)
    return [MusicPresetOut(**p) for p in presets]


@router.put("/themes/music-presets/{preset_id}", response_model=list[MusicPresetOut])
async def update_music_preset(preset_id: str, data: UpdateMusicPresetIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    try:
        presets = await themes_svc.update_music_preset(db, preset_id, data.label, data.description)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return [MusicPresetOut(**p) for p in presets]


@router.delete("/themes/music-presets/{preset_id}", response_model=list[MusicPresetOut])
async def delete_music_preset(preset_id: str, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    try:
        presets = await themes_svc.delete_music_preset(db, preset_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return [MusicPresetOut(**p) for p in presets]


@router.get("/assistant-hints", response_model=list[AssistantHintOut])
async def list_assistant_hints(_: str = Depends(require_developer_permission("assistant")), db: AsyncSession = Depends(get_db)):
    """Explanation messages the assistant mascot shows when a company
    user clicks a hinted nav item or field. `key` must match a real
    `data-robot-hint-key` in the frontend to actually do anything — the
    seeded defaults already do; new ones need matching frontend wiring."""
    return [AssistantHintOut(**h) for h in await assistant_hints_svc.get_assistant_hints(db)]


@router.post("/assistant-hints", response_model=list[AssistantHintOut])
async def add_assistant_hint(data: AddAssistantHintIn, _: str = Depends(require_developer_permission("assistant")), db: AsyncSession = Depends(get_db)):
    try:
        hints = await assistant_hints_svc.add_assistant_hint(db, data.key.strip(), data.label.strip(), data.message.strip())
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return [AssistantHintOut(**h) for h in hints]


@router.put("/assistant-hints/{hint_id}", response_model=list[AssistantHintOut])
async def update_assistant_hint(hint_id: str, data: UpdateAssistantHintIn, _: str = Depends(require_developer_permission("assistant")), db: AsyncSession = Depends(get_db)):
    try:
        hints = await assistant_hints_svc.update_assistant_hint(db, hint_id, data.label.strip(), data.message.strip())
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return [AssistantHintOut(**h) for h in hints]


@router.delete("/assistant-hints/{hint_id}", response_model=list[AssistantHintOut])
async def delete_assistant_hint(hint_id: str, _: str = Depends(require_developer_permission("assistant")), db: AsyncSession = Depends(get_db)):
    hints = await assistant_hints_svc.delete_assistant_hint(db, hint_id)
    return [AssistantHintOut(**h) for h in hints]


@router.get("/assistant-settings", response_model=AssistantSettingsOut)
async def get_assistant_settings(_: str = Depends(require_developer_permission("assistant")), db: AsyncSession = Depends(get_db)):
    """Typing speed, TTS voice, TTS model, and stored intro audio URL."""
    s = await assistant_hints_svc.get_assistant_settings(db)
    return AssistantSettingsOut(**{**s, "intro_audio_url": s.get("intro_audio_url")})


@router.put("/assistant-settings", response_model=AssistantSettingsOut)
async def update_assistant_settings(data: AssistantSettingsIn, _: str = Depends(require_developer_permission("assistant")), db: AsyncSession = Depends(get_db)):
    s = await assistant_hints_svc.set_assistant_settings(db, data.typing_ms_per_char, data.tts_voice, data.tts_model, data.assistant_name)
    return AssistantSettingsOut(**{**s, "intro_audio_url": s.get("intro_audio_url")})


@router.post("/assistant-hints/{hint_id}/generate-audio", response_model=list[AssistantHintOut])
async def generate_hint_audio(hint_id: str, _: str = Depends(require_developer_permission("assistant")), db: AsyncSession = Depends(get_db)):
    """Generates TTS audio for one hint via openai/gpt-4o-mini-audio-preview
    on OpenRouter (same key, no extra setup), uploads to MinIO, stores URL."""
    try:
        hints = await assistant_hints_svc.generate_hint_audio(db, hint_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except RuntimeError as exc:
        raise HTTPException(502, f"Audio generation failed: {exc}")
    return [AssistantHintOut(**h) for h in hints]


@router.post("/assistant-hints/regenerate-all-audio", response_model=list[AssistantHintOut])
async def regenerate_all_hint_audio(_: str = Depends(require_developer_permission("assistant")), db: AsyncSession = Depends(get_db)):
    """Regenerates TTS audio for every hint that already has an audio_url,
    using the currently saved tts_voice and tts_model. Used to bulk-fix
    audio after changing voice or after an S3_PUBLIC_URL change."""
    hints = await assistant_hints_svc.get_assistant_hints(db)
    errors = []
    for hint in hints:
        if not hint.get("audio_url"):
            continue  # skip hints that never had audio
        try:
            hints = await assistant_hints_svc.generate_hint_audio(db, hint["id"])
        except Exception as exc:
            errors.append(f"{hint['id']}: {exc}")
    if errors:
        raise HTTPException(502, f"Some hints failed: {'; '.join(errors)}")
    return [AssistantHintOut(**h) for h in hints]


@router.post("/assistant-intro/generate-audio", response_model=AssistantSettingsOut)
async def generate_intro_audio(data: GenerateIntroAudioIn, _: str = Depends(require_developer_permission("assistant")), db: AsyncSession = Depends(get_db)):
    """Generates and stores TTS for Nova's intro speech."""
    try:
        await assistant_hints_svc.generate_intro_audio(db, data.text)
    except RuntimeError as exc:
        raise HTTPException(502, f"Audio generation failed: {exc}")
    s = await assistant_hints_svc.get_assistant_settings(db)
    return AssistantSettingsOut(**{**s, "intro_audio_url": s.get("intro_audio_url")})


@router.get("/theme-ai/settings", response_model=ThemeAiSettingsOut)
async def get_theme_ai_settings(_: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    """Dedicated model settings for theme AI assistance (Developer >
    Settings) — separate from the video shot-review model, since these
    serve a different purpose. text_model_id/image_transform_model_id
    reference entries from the existing Developer > Models text/image
    lists; vision_model_id references the vision_models list below, which
    is its own addable list since there's no "vision" kind in Models yet."""
    return ThemeAiSettingsOut(**await theme_ai_svc.get_theme_ai_settings(db))


@router.put("/theme-ai/settings", response_model=ThemeAiSettingsOut)
async def update_theme_ai_settings(data: ThemeAiSettingsIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    return ThemeAiSettingsOut(**await theme_ai_svc.set_theme_ai_settings(
        db, data.text_model_id, data.vision_model_id, data.image_transform_model_id,
    ))


@router.post("/theme-ai/vision-models", response_model=ThemeAiSettingsOut)
async def add_vision_model(data: AddVisionModelIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    return ThemeAiSettingsOut(**await theme_ai_svc.add_vision_model(db, data.label, data.model))


@router.delete("/theme-ai/vision-models/{model_id}", response_model=ThemeAiSettingsOut)
async def delete_vision_model(model_id: str, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    return ThemeAiSettingsOut(**await theme_ai_svc.delete_vision_model(db, model_id))


@router.post("/themes/image-theme/generate-prompt", response_model=GenerateTagPromptOut)
async def generate_tag_prompt(data: GenerateTagPromptIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    """Text for Image: called automatically right after a new Style/Product
    tag is added — writes a draft prompt into that tag's textarea for the
    developer to review/edit before saving (never auto-saved)."""
    if data.axis not in ("style", "category"):
        raise HTTPException(422, 'axis must be "style" or "category".')
    try:
        prompt = await theme_ai_svc.generate_tag_prompt(db, data.axis, data.tag)
    except RuntimeError as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"AI prompt generation failed: {exc}")
    return GenerateTagPromptOut(prompt=prompt)


@router.post("/themes/image-theme/generate-all-missing", response_model=GenerateAllMissingOut)
async def generate_all_missing_prompts(_: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    """Fills in a draft prompt for every currently-empty Style/Product tag
    in one go — for backfilling all the tags that existed before this AI
    assistance was added."""
    themes = await themes_svc.get_themes(db)
    result = await theme_ai_svc.generate_all_missing_prompts(db, themes["style_tags"], themes["category_tags"])
    return GenerateAllMissingOut(editor=ImageThemeEditorOut(**result["editor"]), filled=result["filled"], skipped=result["skipped"])


@router.post("/themes/image-gallery/analyze", response_model=AnalyzeThemeImageOut)
async def analyze_theme_image(data: AnalyzeThemeImageIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    """Image for Image: the full AI pipeline for a newly-uploaded reference
    — vision tagging + image-model transform (so a reference sourced from
    the open web never appears verbatim in the app). Returns a draft only;
    nothing is saved to the gallery until the developer confirms via
    POST /themes/image-gallery."""
    themes = await themes_svc.get_themes(db)
    try:
        result = await theme_ai_svc.analyze_and_transform_image(db, data.image, themes["style_tags"], themes["category_tags"])
    except RuntimeError as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"AI image analysis failed: {exc}")
    return AnalyzeThemeImageOut(**result)


@router.post("/themes/image-gallery", response_model=RawThemesOut)
async def save_image_gallery_entry(data: ImageGalleryEntryIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    """Confirms an AI-analyzed (or manually filled) gallery entry —
    creates it if the id is new, overwrites it if the id already exists.
    Stored in the same image_themes list Create Ad's Image Theme
    Reference gallery already reads from. Every entry gets the same
    standard Headline/Discount badge/Body text-overlay fields — every
    Image Theme Reference should offer these, not just some."""
    themes = await themes_svc.get_themes(db)
    image_themes = [t for t in themes["image_themes"] if t["id"] != data.id]
    image_themes.append({
        "id": data.id, "label": data.label, "thumbnail": data.thumbnail,
        "style_tags": data.style_tags, "category_tags": data.category_tags,
        "base_prompt": data.base_prompt, "text_fields": themes_svc.STANDARD_TEXT_FIELDS,
    })
    themes["image_themes"] = image_themes
    saved = await themes_svc.set_themes(db, themes)
    return RawThemesOut(themes=saved)


@router.delete("/themes/image-gallery/{entry_id}", response_model=RawThemesOut)
async def delete_image_gallery_entry(entry_id: str, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    themes = await themes_svc.get_themes(db)
    themes["image_themes"] = [t for t in themes["image_themes"] if t["id"] != entry_id]
    saved = await themes_svc.set_themes(db, themes)
    return RawThemesOut(themes=saved)


@router.get("/themes/video-themes", response_model=list[VideoThemeOut])
async def list_video_themes(_: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    """Video Theme gallery, developer-facing — same list Create Ad reads
    from (GET /ads/video-themes), just with the developer auth guard."""
    themes = await themes_svc.get_themes(db)
    return [VideoThemeOut(**t) for t in themes["video_themes"]]


@router.post("/themes/video-gallery", response_model=list[VideoThemeOut])
async def save_video_theme(data: SaveVideoThemeIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    """Creates or overwrites one Video Theme card by id — same
    upsert-by-id behavior as /themes/image-gallery. Stored in the same
    video_themes list Create Ad's Video Theme Reference tab reads from."""
    themes = await themes_svc.get_themes(db)
    video_themes = [t for t in themes["video_themes"] if t["id"] != data.id]
    video_themes.append({
        "id": data.id, "label": data.label, "thumbnail": data.thumbnail,
        "category_tags": data.category_tags, "style_notes": data.style_notes,
        "shots": [s.model_dump() for s in data.shots],
    })
    themes["video_themes"] = video_themes
    saved = await themes_svc.set_themes(db, themes)
    return [VideoThemeOut(**t) for t in saved["video_themes"]]


@router.delete("/themes/video-gallery/{theme_id}", response_model=list[VideoThemeOut])
async def delete_video_theme(theme_id: str, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    themes = await themes_svc.get_themes(db)
    themes["video_themes"] = [t for t in themes["video_themes"] if t["id"] != theme_id]
    saved = await themes_svc.set_themes(db, themes)
    return [VideoThemeOut(**t) for t in saved["video_themes"]]


@router.post("/themes/video-gallery/generate-draft", response_model=GenerateVideoThemeDraftOut)
async def generate_video_theme_draft(data: GenerateVideoThemeDraftIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    """Drafts a label, style notes, and a small shot list from a short
    brief — reviewed/edited before saving, never auto-saved. Reuses the
    theme text model (Developer > Settings > Theme AI models)."""
    try:
        result = await theme_ai_svc.generate_video_theme_draft(db, data.brief, data.category_tags)
    except RuntimeError as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"AI draft generation failed: {exc}")
    return GenerateVideoThemeDraftOut(**result)


@router.post("/themes/video-gallery/generate-thumbnail", response_model=GenerateVideoThemeThumbnailOut)
async def generate_video_theme_thumbnail(data: GenerateVideoThemeThumbnailIn, _: str = Depends(require_developer_permission("themes")), db: AsyncSession = Depends(get_db)):
    """Renders a single still "hero frame" image (via the theme image
    model) from one of the theme's shot prompts, to use as its gallery
    thumbnail — not an actual video render."""
    try:
        url = await theme_ai_svc.generate_video_theme_thumbnail(db, data.prompt)
    except RuntimeError as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"AI thumbnail generation failed: {exc}")
    return GenerateVideoThemeThumbnailOut(url=url)


@router.put("/models/{model_id}", response_model=DeveloperModelsOut)
async def update_model(model_id: str, data: UpdateModelIn, _: str = Depends(require_developer_permission("models")), db: AsyncSession = Depends(get_db)):
    """Edits an existing entry by id — only overwrites fields explicitly
    provided (fixes a real bug from the old tier system, where an edit
    that only changed credits would silently wipe out a previously-set
    duration range)."""
    models = await credit_svc.get_available_models(db)
    found = False
    for kind in ("text", "image", "video"):
        for entry in models[kind]:
            if entry["id"] == model_id:
                found = True
                if data.label is not None:
                    entry["label"] = data.label
                if data.model is not None:
                    entry["model"] = data.model
                if data.credits is not None:
                    entry["credits"] = data.credits
                if kind == "video":
                    if data.min_duration is not None:
                        entry["min_duration"] = data.min_duration
                    if data.max_duration is not None:
                        entry["max_duration"] = data.max_duration
                    if data.duration_options is not None:
                        entry["duration_options"] = data.duration_options
                    if data.resolutions is not None:
                        entry["resolutions"] = data.resolutions
                    if data.supports_audio is not None:
                        entry["supports_audio"] = data.supports_audio
                    if data.supports_last_frame is not None:
                        entry["supports_last_frame"] = data.supports_last_frame
                    if data.price_per_second_usd is not None:
                        entry["price_per_second_usd"] = data.price_per_second_usd
                if data.pricing is not None:
                    entry["pricing"] = data.pricing
                if data.enabled is not None:
                    if data.enabled is False:
                        currently_enabled = [m for m in models[kind] if m.get("enabled", True)]
                        if len(currently_enabled) <= 1 and entry.get("enabled", True):
                            raise HTTPException(400, f"Can't disable the last enabled {kind} option — Create Ad's dropdown needs at least one to function. Enable another one first.")
                    entry["enabled"] = data.enabled
    if not found:
        raise HTTPException(404, "That model entry no longer exists.")
    await _save_models(db, models)
    return DeveloperModelsOut(text=[DeveloperModelOut(**m) for m in models["text"]], image=[DeveloperModelOut(**m) for m in models["image"]], video=[DeveloperModelOut(**m) for m in models["video"]])


@router.delete("/models/{model_id}", response_model=DeveloperModelsOut)
async def delete_model(model_id: str, _: str = Depends(require_developer_permission("models")), db: AsyncSession = Depends(get_db)):
    """Removes an entry — guarded against leaving a kind with zero
    options at all, since Create Ad's dropdown needs at least one to
    function for that kind."""
    models = await credit_svc.get_available_models(db)
    for kind in ("image", "video"):
        matching = [m for m in models[kind] if m["id"] == model_id]
        if matching:
            if len(models[kind]) <= 1:
                raise HTTPException(400, f"Can't remove the last {kind} option — add a replacement first, or {kind} generation would have nothing to offer.")
            models[kind] = [m for m in models[kind] if m["id"] != model_id]
            await _save_models(db, models)
            return DeveloperModelsOut(text=[DeveloperModelOut(**m) for m in models["text"]], image=[DeveloperModelOut(**m) for m in models["image"]], video=[DeveloperModelOut(**m) for m in models["video"]])
    raise HTTPException(404, "That model entry no longer exists.")


@router.get("/moderation-defaults", response_model=list[GuardrailRuleOut])
async def get_moderation_defaults(_: str = Depends(require_developer_permission("guardrails")), db: AsyncSession = Depends(get_db)):
    """The platform-wide default blocklist terms EVERY company inherits
    (shown read-only to company admins in Admin > Moderation) — this is
    the only place they're actually editable. A company's own custom
    terms (managed in their own Admin > Moderation) are separate and
    untouched by anything here."""
    rows = await get_or_seed_global_rules(db)
    return rows


@router.post("/moderation-defaults", response_model=GuardrailRuleOut, status_code=201)
async def add_moderation_default(data: GuardrailRuleCreateIn, _: str = Depends(require_developer_permission("guardrails")), db: AsyncSession = Depends(get_db)):
    phrase = data.phrase.strip().lower()
    if not phrase:
        raise HTTPException(422, "Rule text cannot be empty")
    existing = await db.scalar(select(GuardrailRule).where(GuardrailRule.company_id.is_(None), GuardrailRule.phrase == phrase))
    if existing:
        raise HTTPException(409, "This default term already exists")
    rule = GuardrailRule(company_id=None, phrase=phrase)
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/moderation-defaults/{rule_id}", status_code=204)
async def delete_moderation_default(rule_id: uuid.UUID, _: str = Depends(require_developer_permission("guardrails")), db: AsyncSession = Depends(get_db)):
    rule = await db.get(GuardrailRule, rule_id)
    if rule is None or rule.company_id is not None:
        # company_id NOT NULL means it's a company's own custom rule,
        # not a global default — correctly out of scope for this
        # endpoint (that company manages it themselves).
        raise HTTPException(404, "Default term not found")
    await db.delete(rule)
    await db.commit()


def _to_out(p: dict) -> PlatformIntegrationOut:
    return PlatformIntegrationOut(
        id=p["id"], label=p["label"], client_id=p.get("client_id", ""),
        has_secret=bool(p.get("client_secret_encrypted")),
        scope=p.get("scope"), redirect_uri=p.get("redirect_uri"),
        enabled=p.get("enabled", True), built=p["id"] in ("linkedin_personal",),  # only LinkedIn personal-profile posting has real integration code so far — see services/linkedin.py; linkedin_company needs the Organization API work discussed but not yet built
        video_ratio=p.get("video_ratio", "1:1"),
    )


@router.get("/platforms", response_model=list[PlatformIntegrationOut])
async def list_platform_integrations(_: str = Depends(require_developer_permission("platforms")), db: AsyncSession = Depends(get_db)):
    return [_to_out(p) for p in await platform_config.get_platform_integrations(db)]


@router.post("/platforms", response_model=list[PlatformIntegrationOut], status_code=201)
async def add_platform_integration(data: AddPlatformIntegrationIn, _: str = Depends(require_developer_permission("platforms")), db: AsyncSession = Depends(get_db)):
    platforms = await platform_config.get_platform_integrations(db)
    if any(p["id"] == data.id for p in platforms):
        raise HTTPException(409, f"A platform with id \"{data.id}\" already exists — edit it instead of adding a duplicate.")
    valid_ratios = await video_ratios_svc.get_video_ratios(db)
    if data.video_ratio not in valid_ratios:
        raise HTTPException(422, f"\"{data.video_ratio}\" isn't one of your configured ratios ({', '.join(valid_ratios)}) — add it under Developer > Video Ratios first, or pick an existing one.")
    platforms.append({
        "id": data.id, "label": data.label, "client_id": data.client_id,
        "client_secret_encrypted": encrypt_token(data.client_secret),
        "scope": data.scope, "redirect_uri": data.redirect_uri, "enabled": True,
        "video_ratio": data.video_ratio,
    })
    await platform_config.save_platform_integrations(db, platforms)
    return [_to_out(p) for p in platforms]


@router.put("/platforms/{platform_id}", response_model=list[PlatformIntegrationOut])
async def update_platform_integration(platform_id: str, data: UpdatePlatformIntegrationIn, _: str = Depends(require_developer_permission("platforms")), db: AsyncSession = Depends(get_db)):
    platforms = await platform_config.get_platform_integrations(db)
    if data.video_ratio is not None:
        valid_ratios = await video_ratios_svc.get_video_ratios(db)
        if data.video_ratio not in valid_ratios:
            raise HTTPException(422, f"\"{data.video_ratio}\" isn't one of your configured ratios ({', '.join(valid_ratios)}) — add it under Developer > Video Ratios first, or pick an existing one.")
    found = False
    for p in platforms:
        if p["id"] == platform_id:
            found = True
            if data.label is not None:
                p["label"] = data.label
            if data.client_id is not None:
                p["client_id"] = data.client_id
            if data.client_secret is not None:
                p["client_secret_encrypted"] = encrypt_token(data.client_secret)
            if data.scope is not None:
                p["scope"] = data.scope
            if data.redirect_uri is not None:
                p["redirect_uri"] = data.redirect_uri
            if data.enabled is not None:
                p["enabled"] = data.enabled
            if data.video_ratio is not None:
                p["video_ratio"] = data.video_ratio
    if not found:
        raise HTTPException(404, "That platform integration no longer exists.")
    await platform_config.save_platform_integrations(db, platforms)
    return [_to_out(p) for p in platforms]


@router.delete("/platforms/{platform_id}", response_model=list[PlatformIntegrationOut])
async def delete_platform_integration(platform_id: str, _: str = Depends(require_developer_permission("platforms")), db: AsyncSession = Depends(get_db)):
    platforms = await platform_config.get_platform_integrations(db)
    remaining = [p for p in platforms if p["id"] != platform_id]
    if len(remaining) == len(platforms):
        raise HTTPException(404, "That platform integration no longer exists.")
    await platform_config.save_platform_integrations(db, remaining)
    return [_to_out(p) for p in remaining]


@router.get("/pricing/markup", response_model=MarkupMultiplierOut)
async def get_markup(_: str = Depends(require_developer_permission("pricing")), db: AsyncSession = Depends(get_db)):
    """The single global markup applied to every dynamically-priced
    model's real OpenRouter cost before converting to credits — see
    services/pricing.py. Agreed target: 1.6-1.8x nets a 20% margin
    after infra and Stripe fees at realistic scale; this defaults to
    1.7 (the middle of that range) until set explicitly."""
    return MarkupMultiplierOut(markup_multiplier=await pricing_svc.get_markup_multiplier(db))


@router.put("/pricing/markup", response_model=MarkupMultiplierOut)
async def update_markup(data: MarkupMultiplierIn, _: str = Depends(require_developer_permission("pricing")), db: AsyncSession = Depends(get_db)):
    await pricing_svc.set_markup_multiplier(db, data.markup_multiplier)
    return MarkupMultiplierOut(markup_multiplier=data.markup_multiplier)


# ── Launch control ────────────────────────────────────────────────────────────

async def _get_launch_cfg_dev(db: AsyncSession) -> dict:
    row = await get_config_row(db, "platform")
    cfg = row.config or {}
    return cfg.get("launch", {})

async def _save_launch_cfg_dev(db: AsyncSession, patch: dict) -> dict:
    row = await get_config_row(db, "platform")
    cfg = dict(row.config or {})
    cfg["launch"] = {**cfg.get("launch", {}), **patch}
    row.config = cfg
    flag_modified(row, "config")
    await db.commit()
    return cfg["launch"]

@router.get("/launch-control")
async def get_launch_control(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    cfg = await _get_launch_cfg_dev(db)
    return {"registration_open": cfg.get("registration_open", settings.REGISTRATION_OPEN)}

@router.put("/launch-control")
async def put_launch_control(body: dict, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    if "registration_open" not in body:
        raise HTTPException(422, "registration_open required")
    saved = await _save_launch_cfg_dev(db, {"registration_open": bool(body["registration_open"])})
    return {"registration_open": saved.get("registration_open", settings.REGISTRATION_OPEN)}


# ── Developer-created users ───────────────────────────────────────────────────
# Bypasses registration — developer creates a company + admin user directly.

@router.post("/create-user", status_code=201)
async def developer_create_user(body: dict, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """Create a company + admin user directly without going through registration.
    Use this to add test/beta users when registration is disabled."""
    from app.models import BrandKit, Subscription, CreditLedger, AuditLog
    from app.security import hash_password

    company_name = str(body.get("company_name", "")).strip()
    email        = str(body.get("email", "")).strip().lower()
    password     = str(body.get("password", "")).strip()
    full_name    = str(body.get("full_name", "")).strip()
    tier         = str(body.get("tier", "free")).strip()

    if not company_name: raise HTTPException(422, "company_name required")
    if not email or "@" not in email: raise HTTPException(422, "Valid email required")
    if len(password) < 8: raise HTTPException(422, "Password must be at least 8 characters")

    existing = await db.scalar(select(User).where(User.email == email))
    if existing: raise HTTPException(409, f"{email} already has an account")

    TIER_CREDITS = {"free": 3, "starter": 10, "growth": 30, "pro": 120}
    credits = TIER_CREDITS.get(tier, 3)

    company = Company(name=company_name)
    db.add(company)
    await db.flush()

    user = User(
        company_id=company.id,
        email=email,
        password_hash=hash_password(password),
        full_name=full_name or email.split("@")[0],
        role="admin",
        status="active",
    )
    db.add(user)
    db.add(Subscription(company_id=company.id, tier=tier, monthly_credits=credits))
    db.add(CreditLedger(company_id=company.id, delta=credits, reason="plan_grant"))
    db.add(BrandKit(company_id=company.id))
    db.add(AuditLog(company_id=company.id, action="company.registered",
                    detail={"email": email, "created_by": "developer"}))
    await db.commit()

    return {
        "company_id": str(company.id),
        "user_id":    str(user.id),
        "email":      email,
        "company":    company_name,
        "tier":       tier,
        "credits":    credits,
    }

@router.get("/created-users")
async def list_developer_created_users(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """List companies created via developer panel (audit log action = company.registered with created_by=developer)."""
    rows = (await db.execute(
        select(AuditLog).where(
            AuditLog.action == "company.registered",
            AuditLog.detail["created_by"].as_string() == "developer"
        ).order_by(AuditLog.created_at.desc()).limit(50)
    )).scalars().all()
    result = []
    for row in rows:
        company = await db.get(Company, row.company_id)
        if not company:
            continue
        # Fetch the admin user for this company
        admin = await db.scalar(
            select(User).where(User.company_id == company.id, User.role == "admin").limit(1)
        )
        # Fetch current subscription tier
        sub = await db.scalar(
            select(Subscription).where(Subscription.company_id == company.id).limit(1)
        )
        result.append({
            "company_id":   str(row.company_id),
            "company_name": company.name,
            "email":        admin.email if admin else row.detail.get("email", ""),
            "full_name":    admin.full_name if admin else "",
            "user_id":      str(admin.id) if admin else None,
            "tier":         sub.tier if sub else "free",
            "created_at":   row.created_at.isoformat(),
        })
    return result


@router.put("/created-users/{company_id}")
async def update_developer_created_user(
    company_id: str,
    body: dict,
    _: str = Depends(require_developer),
    db: AsyncSession = Depends(get_db),
):
    """Edit company name, admin email/full_name, and/or plan tier for a developer-created user."""
    try:
        cid = uuid.UUID(company_id)
    except ValueError:
        raise HTTPException(400, "Invalid company_id")

    company = await db.get(Company, cid)
    if not company:
        raise HTTPException(404, "Company not found")

    admin = await db.scalar(
        select(User).where(User.company_id == cid, User.role == "admin").limit(1)
    )
    sub = await db.scalar(
        select(Subscription).where(Subscription.company_id == cid).limit(1)
    )

    new_company_name = str(body.get("company_name", company.name)).strip()
    new_email        = str(body.get("email", admin.email if admin else "")).strip().lower()
    new_full_name    = str(body.get("full_name", admin.full_name if admin else "")).strip()
    new_tier         = str(body.get("tier", sub.tier if sub else "free")).strip()

    if not new_company_name:
        raise HTTPException(422, "company_name required")
    if not new_email or "@" not in new_email:
        raise HTTPException(422, "Valid email required")

    # Check email uniqueness if changed
    if admin and new_email != admin.email:
        conflict = await db.scalar(select(User).where(User.email == new_email))
        if conflict:
            raise HTTPException(409, f"{new_email} is already in use")

    TIER_CREDITS = {"free": 3, "starter": 10, "growth": 30, "pro": 120}

    company.name = new_company_name

    if admin:
        admin.email     = new_email
        admin.full_name = new_full_name

    if sub and sub.tier != new_tier:
        new_credits = TIER_CREDITS.get(new_tier, 3)
        sub.tier            = new_tier
        sub.monthly_credits = new_credits
        db.add(CreditLedger(company_id=cid, delta=new_credits, reason="plan_grant"))

    db.add(AuditLog(
        company_id=cid,
        action="company.updated",
        detail={"updated_by": "developer", "email": new_email},
    ))
    await db.commit()

    return {
        "company_id":   str(cid),
        "company_name": company.name,
        "email":        admin.email if admin else new_email,
        "full_name":    admin.full_name if admin else new_full_name,
        "user_id":      str(admin.id) if admin else None,
        "tier":         sub.tier if sub else new_tier,
    }


@router.delete("/created-users/{company_id}", status_code=204)
async def delete_developer_created_user(
    company_id: str,
    _: str = Depends(require_developer),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete a developer-created company and all its data."""
    from app.models import (
        BrandKit, BrandLogo, BrandVideoShot, Product, Ad, GenerationJob,
        Campaign, ScheduledPost, PlatformConnection, FlaggedContent,
        CompanyModelConfig, CompanyAgentSettings, Notification,
        AgentEvent, AgentRecommendation, AgentScrapeJob, ScrapedSite,
    )
    try:
        cid = uuid.UUID(company_id)
    except ValueError:
        raise HTTPException(400, "Invalid company_id")

    company = await db.get(Company, cid)
    if not company:
        raise HTTPException(404, "Company not found")

    # Delete in dependency order (children first, then company)
    for model in [
        Notification, AgentEvent, AgentRecommendation, AgentScrapeJob, ScrapedSite,
        FlaggedContent, ScheduledPost, GenerationJob, Ad, Campaign,
        PlatformConnection, Product, BrandVideoShot, BrandLogo, BrandKit,
        CompanyModelConfig, CompanyAgentSettings,
        CreditLedger, Subscription, AuditLog, User,
    ]:
        rows = (await db.execute(select(model).where(model.company_id == cid))).scalars().all()
        for r in rows:
            await db.delete(r)

    await db.delete(company)
    await db.commit()
    return



# Stored in the legacy ModelConfig singleton row (id=1) under a "platform"
# key — no new table or migration needed.

async def _get_platform_cfg(db: AsyncSession) -> dict:
    row = await get_config_row(db, "platform")
    cfg = row.config or {}
    return cfg.get("platform", {})

async def _save_platform_cfg(db: AsyncSession, patch: dict) -> dict:
    row = await get_config_row(db, "platform")
    cfg = dict(row.config or {})
    cfg["platform"] = {**cfg.get("platform", {}), **patch}
    row.config = cfg
    flag_modified(row, "config")
    await db.commit()
    return cfg["platform"]

@router.get("/platform-config")
async def get_platform_config(_: str = Depends(require_developer_permission("settings")), db: AsyncSession = Depends(get_db)):
    """Runtime-editable business values — credit price, carousel cap, Stripe prices, and API base URLs.
    Falls back to .env defaults when no override has been saved yet."""
    saved = await _get_platform_cfg(db)
    return {
        "credit_value_usd":     saved.get("credit_value_usd",     settings.CREDIT_VALUE_USD),
        "carousel_max_images":  saved.get("carousel_max_images",  settings.CAROUSEL_MAX_IMAGES),
        "stripe_price_ids":     saved.get("stripe_price_ids",     settings.STRIPE_PRICE_IDS),
        "stripe_price_topup":   saved.get("stripe_price_topup",   settings.STRIPE_PRICE_TOPUP),
        "openrouter_base_url":  saved.get("openrouter_base_url",  settings.OPENROUTER_BASE_URL),
    }

@router.put("/platform-config")
async def put_platform_config(
    body: dict,
    _: str = Depends(require_developer_permission("settings")),
    db: AsyncSession = Depends(get_db),
):
    import json as _json
    patch: dict = {}

    if "credit_value_usd" in body:
        v = float(body["credit_value_usd"])
        if v <= 0:
            raise HTTPException(422, "credit_value_usd must be positive")
        patch["credit_value_usd"] = round(v, 4)

    if "carousel_max_images" in body:
        v = int(body["carousel_max_images"])
        if v < 2 or v > 20:
            raise HTTPException(422, "carousel_max_images must be between 2 and 20")
        patch["carousel_max_images"] = v

    if "stripe_price_ids" in body:
        val = body["stripe_price_ids"]
        # Accept either a JSON string or a dict
        if isinstance(val, str):
            try:
                val = _json.loads(val)
            except Exception:
                raise HTTPException(422, "stripe_price_ids must be valid JSON")
        if not isinstance(val, dict):
            raise HTTPException(422, "stripe_price_ids must be a JSON object")
        patch["stripe_price_ids"] = _json.dumps(val)   # store as JSON string, matching .env format

    if "stripe_price_topup" in body:
        val = str(body["stripe_price_topup"]).strip()
        if val and not val.startswith("price_"):
            raise HTTPException(422, "stripe_price_topup must be a Stripe price ID (starts with price_)")
        patch["stripe_price_topup"] = val

    if "openrouter_base_url" in body:
        val = str(body["openrouter_base_url"]).rstrip("/").strip()
        if val and not val.startswith("http"):
            raise HTTPException(422, "openrouter_base_url must start with http")
        patch["openrouter_base_url"] = val or settings.OPENROUTER_BASE_URL

    if not patch:
        raise HTTPException(422, "No valid fields to update")

    saved = await _save_platform_cfg(db, patch)

    # Invalidate billing price map cache immediately
    from app.services import billing as billing_svc
    billing_svc.invalidate_price_cache()

    # Apply URL changes to running service module-level constants immediately
    # so the new URLs take effect without restarting the API process
    import importlib
    if "openrouter_base_url" in patch:
        base = patch["openrouter_base_url"]
        for mod_path, attr, suffix in [
            ("app.services.images",   "OPENROUTER_IMAGES_URL", "/images"),
            ("app.services.videos",   "OPENROUTER_VIDEOS_URL", "/videos"),
            ("app.routers.videos",    "OPENROUTER_VIDEOS_URL", "/videos"),
            ("app.services.text_gen", "CHAT_URL",              "/chat/completions"),
        ]:
            try:
                mod = importlib.import_module(mod_path)
                setattr(mod, attr, f"{base}{suffix}")
            except Exception:
                pass
    return {
        "credit_value_usd":     saved.get("credit_value_usd",     settings.CREDIT_VALUE_USD),
        "carousel_max_images":  saved.get("carousel_max_images",  settings.CAROUSEL_MAX_IMAGES),
        "stripe_price_ids":     saved.get("stripe_price_ids",     settings.STRIPE_PRICE_IDS),
        "stripe_price_topup":   saved.get("stripe_price_topup",   settings.STRIPE_PRICE_TOPUP),
        "openrouter_base_url":  saved.get("openrouter_base_url",  settings.OPENROUTER_BASE_URL),
    }


@router.get("/team-limits", response_model=MaxExtraUsersOut)
async def get_team_limit(_: str = Depends(require_developer_permission("settings")), db: AsyncSession = Depends(get_db)):
    """Global cap on non-admin team members per company — see
    services/team_limits.py. Same one number for every company, not a
    per-company override."""
    return MaxExtraUsersOut(max_extra_users=await team_limits_svc.get_max_extra_users(db))


@router.put("/team-limits", response_model=MaxExtraUsersOut)
async def update_team_limit(data: MaxExtraUsersIn, _: str = Depends(require_developer_permission("settings")), db: AsyncSession = Depends(get_db)):
    await team_limits_svc.set_max_extra_users(db, data.max_extra_users)
    return MaxExtraUsersOut(max_extra_users=data.max_extra_users)


@router.get("/retention", response_model=RetentionMonthsOut)
async def get_retention(_: str = Depends(require_developer_permission("settings")), db: AsyncSession = Depends(get_db)):
    """How many months a generated ad's media (images/videos) stays in
    storage before automatic cleanup — see services/retention.py.
    Option B: only the files go away, the ad record/caption/analytics
    stay forever. This same number also caps how far out a post can be
    scheduled (anchored to each ad's own creation date), so the two
    settings can never drift apart."""
    return RetentionMonthsOut(retention_months=await retention_svc.get_retention_months(db))


@router.put("/retention", response_model=RetentionMonthsOut)
async def update_retention(data: RetentionMonthsIn, _: str = Depends(require_developer_permission("settings")), db: AsyncSession = Depends(get_db)):
    await retention_svc.set_retention_months(db, data.retention_months)
    return RetentionMonthsOut(retention_months=data.retention_months)


@router.get("/post-retention", response_model=PostRetentionMonthsOut)
async def get_post_retention(_: str = Depends(require_developer_permission("settings")), db: AsyncSession = Depends(get_db)):
    """How many months an ad's ENTIRE RECORD (not just its media) stays
    in the database before being permanently deleted — separate from
    and much longer than media-only retention above. See
    services/retention.py and tasks.cleanup_expired_posts."""
    return PostRetentionMonthsOut(post_retention_months=await retention_svc.get_post_retention_months(db))


@router.put("/post-retention", response_model=PostRetentionMonthsOut)
async def update_post_retention(data: PostRetentionMonthsIn, _: str = Depends(require_developer_permission("settings")), db: AsyncSession = Depends(get_db)):
    await retention_svc.set_post_retention_months(db, data.post_retention_months)
    return PostRetentionMonthsOut(post_retention_months=data.post_retention_months)


@router.get("/video-prep", response_model=VideoPrepSettingsOut)
async def get_video_prep(_: str = Depends(require_developer_permission("settings")), db: AsyncSession = Depends(get_db)):
    return VideoPrepSettingsOut(**await video_prep_svc.get_video_prep_settings(db))


@router.put("/video-prep", response_model=VideoPrepSettingsOut)
async def update_video_prep(data: VideoPrepSettingsIn, _: str = Depends(require_developer_permission("settings")), db: AsyncSession = Depends(get_db)):
    await video_prep_svc.set_video_prep_settings(db, data.prompt_review_model_id, data.image_model_id)
    return VideoPrepSettingsOut(prompt_review_model_id=data.prompt_review_model_id, image_model_id=data.image_model_id)


@router.get("/video-ratios", response_model=VideoRatiosOut)
async def get_video_ratios(_: str = Depends(require_developer_permission("settings")), db: AsyncSession = Depends(get_db)):
    """The developer-managed list of available aspect ratios — just the
    ratio strings, not fixed pixel sizes (see services/video_ratios.py
    and services/reframe.py, which computes real dimensions from each
    source video's own resolution)."""
    return VideoRatiosOut(ratios=await video_ratios_svc.get_video_ratios(db))


@router.post("/video-ratios", response_model=VideoRatiosOut, status_code=201)
async def add_video_ratio(data: AddVideoRatioIn, _: str = Depends(require_developer_permission("settings")), db: AsyncSession = Depends(get_db)):
    ratios = await video_ratios_svc.add_video_ratio(db, data.ratio)
    return VideoRatiosOut(ratios=ratios)


@router.get("/video-ratios/{ratio}/usage", response_model=RatioUsageOut)
async def get_ratio_usage(ratio: str, _: str = Depends(require_developer_permission("settings")), db: AsyncSession = Depends(get_db)):
    """Called before a delete is confirmed — shows what's currently
    referencing this ratio, so the developer can make an informed
    choice. Deletion itself is never blocked, only warned about."""
    usage = await video_ratios_svc.check_ratio_usage(db, ratio)
    return RatioUsageOut(**usage)


@router.delete("/video-ratios/{ratio}", response_model=VideoRatiosOut)
async def delete_video_ratio(ratio: str, _: str = Depends(require_developer_permission("settings")), db: AsyncSession = Depends(get_db)):
    """Not blocked even if still in use — per the agreed design, the
    frontend shows a warning (via the usage endpoint above) and lets
    the developer confirm anyway. Anything still referencing this ratio
    afterward silently falls back to a default the next time it's read
    (services/video_ratios.py's resolve_ratio), rather than breaking."""
    ratios = await video_ratios_svc.remove_video_ratio(db, ratio)
    return VideoRatiosOut(ratios=ratios)


# ── Infrastructure health & DB setup ──────────────────────────────────────────

@router.get("/infrastructure/status")
async def infrastructure_status(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """Live health check for every service: DB, Redis, S3/R2, and OpenRouter.
    Returns a status card per service so the developer panel can render
    a colour-coded grid without multiple round-trips. Each service is
    probed independently so one failure doesn't prevent the others from
    reporting."""

    results: dict[str, dict] = {}

    # ── Database ─────────────────────────────────────────────────────
    db_start = datetime.utcnow()
    try:
        from sqlalchemy import text
        await db.execute(text("SELECT 1"))
        db_ms = round((datetime.utcnow() - db_start).total_seconds() * 1000, 1)

        # Migration status: current head vs applied revision
        from sqlalchemy import text as _text
        try:
            rev_row = await db.execute(_text(
                "SELECT version_num FROM alembic_version LIMIT 1"
            ))
            current_rev = (rev_row.scalar() or "none")
        except Exception:
            current_rev = "alembic_version table missing — migrations not run"

        # Read the latest revision id from the migration files on disk
        # (the files are always present in the container)
        alembic_dir = os.path.join(os.path.dirname(__file__), "..", "..", "alembic", "versions")
        alembic_dir = os.path.normpath(alembic_dir)
        head_rev = "unknown"
        try:
            files = [f for f in os.listdir(alembic_dir) if f.endswith(".py") and not f.startswith("__")]
            rev_map: dict[str, str] = {}   # down_revision → revision
            rev_to_file: dict[str, str] = {}
            for fname in files:
                fpath = os.path.join(alembic_dir, fname)
                content = open(fpath).read()
                rev_match = None; down_match = None
                for line in content.splitlines():
                    ls = line.strip()
                    if ls.startswith("revision") and "=" in ls and not ls.startswith("#"):
                        rev_match = ls.split("=")[-1].strip().strip("'\"")
                    if ls.startswith("down_revision") and "=" in ls and not ls.startswith("#"):
                        val = ls.split("=")[-1].strip().strip("'\"")
                        down_match = None if val in ("None", "") else val
                if rev_match:
                    rev_map[down_match] = rev_match
                    rev_to_file[rev_match] = fname
            # Walk the chain to find the tip (revision no other revision points down to)
            all_revs = set(rev_map.values())
            all_downs = set(rev_map.keys()) - {None}
            tips = all_revs - all_downs
            head_rev = tips.pop() if tips else "unknown"
        except Exception as e:
            head_rev = f"error reading migrations: {e}"

        migrations_current = (current_rev == head_rev)
        results["database"] = {
            "status": "ok",
            "latency_ms": db_ms,
            "detail": f"Connected to PostgreSQL",
            "migration_head": head_rev,
            "migration_current": current_rev,
            "migrations_current": migrations_current,
        }
    except Exception as exc:
        results["database"] = {
            "status": "error",
            "latency_ms": None,
            "detail": str(exc),
            "migration_head": None,
            "migration_current": None,
            "migrations_current": False,
        }

    # ── Redis ─────────────────────────────────────────────────────────
    redis_start = datetime.utcnow()
    try:
        r = redis_lib.from_url(settings.REDIS_URL, socket_connect_timeout=3)
        pong = await asyncio.get_event_loop().run_in_executor(None, r.ping)
        redis_ms = round((datetime.utcnow() - redis_start).total_seconds() * 1000, 1)
        # Queue depth from Celery's default queue
        try:
            q_len = await asyncio.get_event_loop().run_in_executor(None, lambda: r.llen("celery"))
        except Exception:
            q_len = None
        results["redis"] = {
            "status": "ok" if pong else "error",
            "latency_ms": redis_ms,
            "detail": "Connected",
            "queue_depth": q_len,
        }
    except Exception as exc:
        results["redis"] = {
            "status": "error",
            "latency_ms": None,
            "detail": str(exc),
            "queue_depth": None,
        }

    # ── S3 / R2 ───────────────────────────────────────────────────────
    s3_start = datetime.utcnow()
    try:
        import boto3
        from botocore.client import Config as BotoConfig
        s3_client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            config=BotoConfig(signature_version="s3v4"),
            region_name="us-east-1",
        )
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: s3_client.head_bucket(Bucket=settings.S3_BUCKET)
        )
        s3_ms = round((datetime.utcnow() - s3_start).total_seconds() * 1000, 1)
        results["storage"] = {
            "status": "ok",
            "latency_ms": s3_ms,
            "detail": f"Bucket '{settings.S3_BUCKET}' reachable at {settings.S3_ENDPOINT_URL}",
        }
    except Exception as exc:
        s3_ms = round((datetime.utcnow() - s3_start).total_seconds() * 1000, 1)
        results["storage"] = {
            "status": "error",
            "latency_ms": s3_ms,
            "detail": str(exc),
        }

    # ── OpenRouter ────────────────────────────────────────────────────
    or_start = datetime.utcnow()
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(
                f"{settings.OPENROUTER_BASE_URL.rstrip('/')}/auth/key",
                headers={"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}"},
            )
        or_ms = round((datetime.utcnow() - or_start).total_seconds() * 1000, 1)
        if resp.status_code == 200:
            data = resp.json().get("data", {})
            results["openrouter"] = {
                "status": "ok",
                "latency_ms": or_ms,
                "detail": f"Key valid — label: {data.get('label', 'n/a')}",
                "credits_remaining": data.get("limit_remaining"),
            }
        else:
            results["openrouter"] = {
                "status": "error",
                "latency_ms": or_ms,
                "detail": f"HTTP {resp.status_code}: {resp.text[:200]}",
                "credits_remaining": None,
            }
    except Exception as exc:
        results["openrouter"] = {
            "status": "error",
            "latency_ms": None,
            "detail": str(exc),
            "credits_remaining": None,
        }

    # ── SMTP (quick TCP connect, no AUTH round-trip) ─────────────────
    smtp_start = datetime.utcnow()
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(settings.SMTP_HOST, settings.SMTP_PORT),
            timeout=5,
        )
        writer.close()
        await writer.wait_closed()
        smtp_ms = round((datetime.utcnow() - smtp_start).total_seconds() * 1000, 1)
        results["smtp"] = {
            "status": "ok",
            "latency_ms": smtp_ms,
            "detail": f"{settings.SMTP_HOST}:{settings.SMTP_PORT} reachable",
        }
    except Exception as exc:
        smtp_ms = round((datetime.utcnow() - smtp_start).total_seconds() * 1000, 1)
        results["smtp"] = {
            "status": "error",
            "latency_ms": smtp_ms,
            "detail": str(exc),
        }

    return {
        "checked_at": datetime.utcnow().isoformat() + "Z",
        "services": results,
    }


@router.post("/infrastructure/run-migrations")
async def run_migrations(_: str = Depends(require_developer)):
    """Run `alembic upgrade head` inside the container.  Returns the full
    stdout/stderr so the developer can see exactly what was applied.
    This is deliberately owner-only (no permission key) — it's a
    destructive-capable operation and team members should never trigger
    it without explicit authorisation."""
    try:
        # Resolve the alembic root (one level above app/)
        backend_root = os.path.normpath(
            os.path.join(os.path.dirname(__file__), "..", "..")
        )
        proc = await asyncio.create_subprocess_exec(
            "alembic", "upgrade", "head",
            cwd=backend_root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ},   # inherit DATABASE_URL etc from the running process
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        output = stdout.decode() + stderr.decode()
        if proc.returncode == 0:
            return {"ok": True, "output": output.strip()}
        else:
            raise HTTPException(500, detail=f"alembic exited with code {proc.returncode}:\n{output.strip()}")
    except asyncio.TimeoutError:
        raise HTTPException(504, detail="Migration timed out after 120 seconds")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, detail=str(exc))


@router.get("/infrastructure/migration-history")
async def migration_history(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """Returns the ordered list of every migration file with its revision id,
    description, and whether it has been applied to the current database.
    Applied revisions come from the alembic_version table; since Alembic
    only tracks the current HEAD (not a full applied log), we reconstruct
    the chain from the migration files themselves and mark everything up
    to and including the current HEAD as applied."""
    from sqlalchemy import text

    try:
        rev_row = await db.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
        current_rev = rev_row.scalar() or ""
    except Exception:
        current_rev = ""

    alembic_dir = os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "..", "alembic", "versions")
    )

    migrations = []
    try:
        files = [f for f in os.listdir(alembic_dir) if f.endswith(".py") and not f.startswith("__")]
        rev_info: dict[str, dict] = {}
        for fname in files:
            fpath = os.path.join(alembic_dir, fname)
            content = open(fpath).read()
            revision = down_revision = description = create_date = None
            for line in content.splitlines():
                ls = line.strip()
                if ls.startswith("revision") and "=" in ls and not ls.startswith("#"):
                    revision = ls.split("=")[-1].strip().strip("'\"")
                elif ls.startswith("down_revision") and "=" in ls and not ls.startswith("#"):
                    val = ls.split("=")[-1].strip().strip("'\"")
                    down_revision = None if val in ("None", "") else val
                elif ls.startswith('"""') and description is None:
                    description = ls.strip('"""').strip()
                elif "Create Date:" in ls:
                    create_date = ls.replace("Create Date:", "").strip()
            if revision:
                rev_info[revision] = {
                    "revision": revision,
                    "down_revision": down_revision,
                    "description": description or fname,
                    "create_date": create_date,
                    "filename": fname,
                }

        # Walk chain from None (initial) to tip
        ordered: list[dict] = []
        next_rev: str | None = None
        # Build forward map: down_revision → revision
        forward: dict[str | None, str] = {v["down_revision"]: k for k, v in rev_info.items()}
        cursor: str | None = None
        for _ in range(len(rev_info) + 1):   # guard against infinite loop on broken chains
            nxt = forward.get(cursor)
            if nxt is None:
                break
            ordered.append(rev_info[nxt])
            cursor = nxt

        # Mark applied: every revision in the chain up to and including current_rev
        applied_set: set[str] = set()
        if current_rev:
            for m in ordered:
                applied_set.add(m["revision"])
                if m["revision"] == current_rev:
                    break

        for m in ordered:
            m["applied"] = m["revision"] in applied_set

        migrations = ordered
    except Exception as exc:
        return {"current_revision": current_rev, "migrations": [], "error": str(exc)}

    return {
        "current_revision": current_rev,
        "total": len(migrations),
        "applied": sum(1 for m in migrations if m["applied"]),
        "pending": sum(1 for m in migrations if not m["applied"]),
        "migrations": migrations,
    }


# ── Email suppression management ──────────────────────────────────────────────

@router.get("/email-suppressions")
async def list_email_suppressions(
    _: str = Depends(require_developer),
    db: AsyncSession = Depends(get_db),
):
    """Returns all suppressed email addresses with reason and date.
    Used by the Developer → Email Health panel."""
    from app.models import EmailSuppression
    rows = (await db.scalars(
        select(EmailSuppression).order_by(EmailSuppression.created_at.desc())
    )).all()
    return {
        "total": len(rows),
        "bounces": sum(1 for r in rows if r.reason == "bounce"),
        "complaints": sum(1 for r in rows if r.reason == "complaint"),
        "suppressions": [
            {
                "id": r.id,
                "email": r.email,
                "reason": r.reason,
                "detail": r.detail,
                "created_at": r.created_at.isoformat() + "Z",
            }
            for r in rows
        ],
    }


@router.delete("/email-suppressions/{suppression_id}")
async def remove_email_suppression(
    suppression_id: int,
    _: str = Depends(require_developer),
    db: AsyncSession = Depends(get_db),
):
    """Remove a suppression entry — use when an address was suppressed in error
    or the recipient has confirmed they want to receive emails again."""
    from app.models import EmailSuppression
    row = await db.get(EmailSuppression, suppression_id)
    if not row:
        raise HTTPException(404, "Suppression not found")
    email = row.email
    await db.delete(row)
    db.add(AuditLog(action="email.suppression_removed", detail={"email": email}))
    await db.commit()
    return {"removed": True, "email": email}


@router.get("/email-health")
async def email_health(
    _: str = Depends(require_developer),
    db: AsyncSession = Depends(get_db),
):
    """Returns suppression stats and recent audit log entries for bounce/complaint
    events. Gives the developer a quick health overview without loading the
    full suppression list."""
    from app.models import EmailSuppression
    from sqlalchemy import func

    total = await db.scalar(select(func.count()).select_from(EmailSuppression)) or 0
    bounces = await db.scalar(
        select(func.count()).select_from(EmailSuppression).where(EmailSuppression.reason == "bounce")
    ) or 0
    complaints = await db.scalar(
        select(func.count()).select_from(EmailSuppression).where(EmailSuppression.reason == "complaint")
    ) or 0

    # Last 10 suppression events from audit log
    recent = (await db.scalars(
        select(AuditLog)
        .where(AuditLog.action.in_(["email.bounce_suppressed", "email.complaint_suppressed", "email.suppression_removed"]))
        .order_by(AuditLog.created_at.desc())
        .limit(20)
    )).all()

    return {
        "total_suppressed": total,
        "bounces": bounces,
        "complaints": complaints,
        "recent_events": [
            {
                "action": r.action,
                "detail": r.detail,
                "created_at": r.created_at.isoformat() + "Z",
            }
            for r in recent
        ],
    }


# ── Railway billing & usage ────────────────────────────────────────────────────

@router.get("/railway-usage")
async def get_railway_usage(_: str = Depends(require_developer)):
    """Fetch current billing usage and service metrics from Railway's GraphQL API.
    Requires RAILWAY_API_TOKEN env var set on the api service."""
    token = settings.RAILWAY_API_TOKEN
    if not token:
        raise HTTPException(503, "RAILWAY_API_TOKEN is not set — add it to the api service environment variables on Railway.")

    project_id = settings.RAILWAY_PROJECT_ID
    if not project_id:
        raise HTTPException(503, "RAILWAY_PROJECT_ID is not set — add it to the api service environment variables on Railway.")

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    # Query project services only — Railway's billing fields are not
    # exposed in the public GraphQL API as of mid-2026.
    services_query = f"""
    query {{
      project(id: "{project_id}") {{
        id
        name
        services {{
          edges {{
            node {{
              id
              name
              serviceInstances {{
                edges {{
                  node {{
                    latestDeployment {{
                      status
                      createdAt
                    }}
                    region
                  }}
                }}
              }}
            }}
          }}
        }}
      }}
    }}
    """

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.post(
                "https://backboard.railway.com/graphql/v2",
                headers=headers,
                json={"query": services_query},
            )
            resp_data = resp.json()
        except Exception as e:
            raise HTTPException(502, f"Could not reach Railway API: {e}")

    errors = resp_data.get("errors", [])
    data = resp_data.get("data") or {}

    if not data and errors:
        raise HTTPException(502, f"Railway API error: {errors[0].get('message', 'Unknown error')}")

    # Extract services
    services_out = []
    project = data.get("project") or {}
    for edge in project.get("services", {}).get("edges", []):
        svc = edge["node"]
        instances = svc.get("serviceInstances", {}).get("edges", [])
        latest_deployment = None
        region = None
        if instances:
            inst = instances[0]["node"]
            latest_deployment = inst.get("latestDeployment")
            region = inst.get("region")
        services_out.append({
            "id": svc["id"],
            "name": svc["name"],
            "region": region,
            "status": latest_deployment.get("status") if latest_deployment else "UNKNOWN",
            "deployed_at": latest_deployment.get("createdAt") if latest_deployment else None,
        })

    return {
        "estimated_monthly_usd": None,
        "current_period_usd": None,
        "credit_balance_usd": None,
        "project_name": project.get("name"),
        "services": services_out,
        "api_notes": [e.get("message") for e in errors] if errors else [],
    }
