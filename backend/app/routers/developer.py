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
from app.deps import require_developer
from app.models import Ad, Campaign, Company, CreditLedger, FlaggedContent, GuardrailRule, ModelConfig, Subscription, User
from app.schemas import (
    AddModelIn, AddPlatformIntegrationIn, AddVideoRatioIn, CompanyAdminOut, DeveloperLoginIn,
    DeveloperModelOut, DeveloperModelsOut, DeveloperTokenOut, GuardrailRuleCreateIn, GuardrailRuleOut,
    MarkupMultiplierIn, MarkupMultiplierOut, MaxExtraUsersIn, MaxExtraUsersOut, OpenRouterCatalogModelOut,
    OpenRouterCreditsOut, PlatformIntegrationOut, PlatformOverviewOut, PostRetentionMonthsIn,
    PostRetentionMonthsOut, RatioUsageOut, RawModelsIn, RawModelsOut, ReorderModelsIn, RetentionMonthsIn,
    RetentionMonthsOut, UpdateModelIn, UpdatePlatformIntegrationIn, VideoPrepSettingsIn, VideoPrepSettingsOut,
    VideoRatiosOut,
)
from app.security import create_developer_token
from app.services import credits as credit_svc
from app.services import platform_config
from app.services import pricing as pricing_svc
from app.services import retention as retention_svc
from app.services import team_limits as team_limits_svc
from app.services import video_prep as video_prep_svc
from app.services import video_ratios as video_ratios_svc
from app.services.guardrails import get_or_seed_global_rules
from app.services.token_crypto import encrypt_token

router = APIRouter(prefix="/developer", tags=["developer"])

# Real, current tier pricing (see scripts/setup_stripe_prices.py) — used
# only for the estimated MRR figure on the overview. If pricing ever
# changes, update both places.
TIER_MONTHLY_USD = {"free": 0, "starter": 29, "growth": 79, "pro": 199}


@router.post("/login", response_model=DeveloperTokenOut)
async def developer_login(data: DeveloperLoginIn):
    if not settings.DEVELOPER_EMAIL or not settings.DEVELOPER_PASSWORD:
        raise HTTPException(503, "Developer login is not configured on this server (DEVELOPER_EMAIL/DEVELOPER_PASSWORD unset in .env).")
    # Plain comparison, deliberately — this credential lives in .env
    # alongside JWT_SECRET and STRIPE_SECRET_KEY, which are already the
    # trust boundary for this whole app. No database round-trip at all.
    if data.email != settings.DEVELOPER_EMAIL or data.password != settings.DEVELOPER_PASSWORD:
        raise HTTPException(401, "Invalid developer credentials")
    return DeveloperTokenOut(access_token=create_developer_token())


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
async def get_openrouter_credits(_: str = Depends(require_developer)):
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
async def browse_openrouter_catalog(kind: str, _: str = Depends(require_developer)):
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
async def list_companies(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
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
async def get_global_models(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
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
async def add_model(data: AddModelIn, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
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
async def reorder_models(data: ReorderModelsIn, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
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
async def get_models_raw(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """The entire text/image/video model list as one JSON blob, exactly
    as stored — for bulk editing in one shot instead of one field at a
    time through the form UI. Addresses the real pain of a pricing JSON
    (or any other field) silently not sticking through the piecemeal
    edit form: edit and save the WHOLE structure atomically here
    instead, and there's nothing left to partially apply."""
    models = await credit_svc.get_available_models(db)
    return RawModelsOut(models=models)


@router.put("/models/raw", response_model=DeveloperModelsOut)
async def update_models_raw(data: RawModelsIn, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
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


@router.put("/models/{model_id}", response_model=DeveloperModelsOut)
async def update_model(model_id: str, data: UpdateModelIn, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
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
async def delete_model(model_id: str, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
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
async def get_moderation_defaults(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """The platform-wide default blocklist terms EVERY company inherits
    (shown read-only to company admins in Admin > Moderation) — this is
    the only place they're actually editable. A company's own custom
    terms (managed in their own Admin > Moderation) are separate and
    untouched by anything here."""
    rows = await get_or_seed_global_rules(db)
    return rows


@router.post("/moderation-defaults", response_model=GuardrailRuleOut, status_code=201)
async def add_moderation_default(data: GuardrailRuleCreateIn, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
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
async def delete_moderation_default(rule_id: uuid.UUID, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
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
async def list_platform_integrations(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    return [_to_out(p) for p in await platform_config.get_platform_integrations(db)]


@router.post("/platforms", response_model=list[PlatformIntegrationOut], status_code=201)
async def add_platform_integration(data: AddPlatformIntegrationIn, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
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
async def update_platform_integration(platform_id: str, data: UpdatePlatformIntegrationIn, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
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
async def delete_platform_integration(platform_id: str, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    platforms = await platform_config.get_platform_integrations(db)
    remaining = [p for p in platforms if p["id"] != platform_id]
    if len(remaining) == len(platforms):
        raise HTTPException(404, "That platform integration no longer exists.")
    await platform_config.save_platform_integrations(db, remaining)
    return [_to_out(p) for p in remaining]


@router.get("/pricing/markup", response_model=MarkupMultiplierOut)
async def get_markup(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """The single global markup applied to every dynamically-priced
    model's real OpenRouter cost before converting to credits — see
    services/pricing.py. Agreed target: 1.6-1.8x nets a 20% margin
    after infra and Stripe fees at realistic scale; this defaults to
    1.7 (the middle of that range) until set explicitly."""
    return MarkupMultiplierOut(markup_multiplier=await pricing_svc.get_markup_multiplier(db))


@router.put("/pricing/markup", response_model=MarkupMultiplierOut)
async def update_markup(data: MarkupMultiplierIn, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    await pricing_svc.set_markup_multiplier(db, data.markup_multiplier)
    return MarkupMultiplierOut(markup_multiplier=data.markup_multiplier)


@router.get("/team-limits", response_model=MaxExtraUsersOut)
async def get_team_limit(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """Global cap on non-admin team members per company — see
    services/team_limits.py. Same one number for every company, not a
    per-company override."""
    return MaxExtraUsersOut(max_extra_users=await team_limits_svc.get_max_extra_users(db))


@router.put("/team-limits", response_model=MaxExtraUsersOut)
async def update_team_limit(data: MaxExtraUsersIn, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    await team_limits_svc.set_max_extra_users(db, data.max_extra_users)
    return MaxExtraUsersOut(max_extra_users=data.max_extra_users)


@router.get("/retention", response_model=RetentionMonthsOut)
async def get_retention(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """How many months a generated ad's media (images/videos) stays in
    storage before automatic cleanup — see services/retention.py.
    Option B: only the files go away, the ad record/caption/analytics
    stay forever. This same number also caps how far out a post can be
    scheduled (anchored to each ad's own creation date), so the two
    settings can never drift apart."""
    return RetentionMonthsOut(retention_months=await retention_svc.get_retention_months(db))


@router.put("/retention", response_model=RetentionMonthsOut)
async def update_retention(data: RetentionMonthsIn, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    await retention_svc.set_retention_months(db, data.retention_months)
    return RetentionMonthsOut(retention_months=data.retention_months)


@router.get("/post-retention", response_model=PostRetentionMonthsOut)
async def get_post_retention(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """How many months an ad's ENTIRE RECORD (not just its media) stays
    in the database before being permanently deleted — separate from
    and much longer than media-only retention above. See
    services/retention.py and tasks.cleanup_expired_posts."""
    return PostRetentionMonthsOut(post_retention_months=await retention_svc.get_post_retention_months(db))


@router.put("/post-retention", response_model=PostRetentionMonthsOut)
async def update_post_retention(data: PostRetentionMonthsIn, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    await retention_svc.set_post_retention_months(db, data.post_retention_months)
    return PostRetentionMonthsOut(post_retention_months=data.post_retention_months)


@router.get("/video-prep", response_model=VideoPrepSettingsOut)
async def get_video_prep(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    return VideoPrepSettingsOut(**await video_prep_svc.get_video_prep_settings(db))


@router.put("/video-prep", response_model=VideoPrepSettingsOut)
async def update_video_prep(data: VideoPrepSettingsIn, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    await video_prep_svc.set_video_prep_settings(db, data.prompt_review_model_id, data.image_model_id)
    return VideoPrepSettingsOut(prompt_review_model_id=data.prompt_review_model_id, image_model_id=data.image_model_id)


@router.get("/video-ratios", response_model=VideoRatiosOut)
async def get_video_ratios(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """The developer-managed list of available aspect ratios — just the
    ratio strings, not fixed pixel sizes (see services/video_ratios.py
    and services/reframe.py, which computes real dimensions from each
    source video's own resolution)."""
    return VideoRatiosOut(ratios=await video_ratios_svc.get_video_ratios(db))


@router.post("/video-ratios", response_model=VideoRatiosOut, status_code=201)
async def add_video_ratio(data: AddVideoRatioIn, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    ratios = await video_ratios_svc.add_video_ratio(db, data.ratio)
    return VideoRatiosOut(ratios=ratios)


@router.get("/video-ratios/{ratio}/usage", response_model=RatioUsageOut)
async def get_ratio_usage(ratio: str, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """Called before a delete is confirmed — shows what's currently
    referencing this ratio, so the developer can make an informed
    choice. Deletion itself is never blocked, only warned about."""
    usage = await video_ratios_svc.check_ratio_usage(db, ratio)
    return RatioUsageOut(**usage)


@router.delete("/video-ratios/{ratio}", response_model=VideoRatiosOut)
async def delete_video_ratio(ratio: str, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """Not blocked even if still in use — per the agreed design, the
    frontend shows a warning (via the usage endpoint above) and lets
    the developer confirm anyway. Anything still referencing this ratio
    afterward silently falls back to a default the next time it's read
    (services/video_ratios.py's resolve_ratio), rather than breaking."""
    ratios = await video_ratios_svc.remove_video_ratio(db, ratio)
    return VideoRatiosOut(ratios=ratios)
