"""Platform-operator routes — entirely separate from the per-company
user/admin system. Auth here is checked directly against
DEVELOPER_EMAIL/DEVELOPER_PASSWORD in .env (see require_developer in
deps.py); nothing in this file ever creates or reads a User row, and no
company's admin can reach any of this regardless of their role or
capabilities — there is no code path that connects the two systems."""
import uuid
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.config import settings
from app.database import get_db
from app.deps import require_developer, require_developer_permission
from app.models import Ad, Campaign, Company, CreditLedger, FlaggedContent, GuardrailRule, ModelConfig, Subscription, User
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
            "https://openrouter.ai/api/v1/credits",
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

    url = "https://openrouter.ai/api/v1/videos/models" if kind == "video" else "https://openrouter.ai/api/v1/images/models"
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
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    config["image"] = models["image"]
    config["video"] = models["video"]
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
