import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.models import CreditLedger, ModelConfig, get_config_row, get_config_row_sync

# Seed values only — used to populate the list the FIRST time it's ever
# read (before any developer edit exists). From that point on, the
# stored list in ModelConfig is the sole source of truth; these defaults
# are never consulted again, so editing/adding/removing entries via
# Developer > Models fully replaces what's here, it doesn't merge with
# it. This replaces the old fixed low/medium/best/super TIER system —
# there's no longer a fixed number of options or a company-wide "active"
# choice; the developer maintains an open-ended list, and each ad picks
# a specific model directly (see AdCreateIn.image_model_id/
# video_model_id) rather than inheriting a shared default.
DEFAULT_MODELS = {
    # TEXT — new as of 2026-07-15. Was previously free/bundled into every
    # ad; now priced the same way image/video are, and routed through
    # OpenRouter exactly like image/video (no direct-Anthropic path) —
    # one consistent system for all three kinds. Credits computed via
    # compute_text_credits floor at 1 regardless of the model's real
    # (tiny) per-call cost — see services/pricing.py.
    "text": [
        # 0.25 credits = goodwill floor at $0.10/credit with 2.5× markup.
        # Real per-call cost is ~$0.001 — we charge a small amount so
        # credits remain meaningful rather than making text entirely free.
        {"id": "txt-gemini", "label": "Gemini 2.5 Flash", "model": "google/gemini-2.5-flash", "credits": 0.25},
        {"id": "txt-haiku", "label": "Claude Haiku 4.5", "model": "anthropic/claude-haiku-4.5", "credits": 0.25},
        {"id": "txt-deepseek", "label": "DeepSeek V4 Flash", "model": "deepseek/deepseek-v4-flash", "credits": 0.25},
    ],
    "image": [
        # cost_usd = real OpenRouter cost per image generation.
        # Dynamic pricing: charged = cost_usd × markup ÷ credit_value_usd, rounded to 0.25.
        # At 2.5× markup, $0.10/credit:
        #   GPT Image 1 Mini  $0.04  → $0.10 → 1.0 credit
        #   Gemini 2.5 Flash  $0.068 → $0.17 → 1.75 credits
        #   FLUX.2 Pro        $0.12  → $0.30 → 3.0 credits
        {"id": "img-fast",     "label": "GPT Image 1 Mini",       "model": "openai/gpt-image-1-mini",          "credits": 1.0,  "pricing": {"cost_usd": 0.04}},
        {"id": "img-balanced", "label": "Gemini 2.5 Flash Image", "model": "google/gemini-2.5-flash-image",    "credits": 1.75, "pricing": {"cost_usd": 0.068}},
        {"id": "img-premium",  "label": "FLUX.2 Pro",             "model": "black-forest-labs/flux.2-pro",     "credits": 3.0,  "pricing": {"cost_usd": 0.12}},
    ],
    # Video credits are dynamic (per-second × duration × markup ÷ credit_value_usd).
    # The flat "credits" value here is the REFERENCE shown in the dropdown before
    # a specific duration is chosen — computed at min_duration as a floor estimate.
    # Real cost is always calculated live via compute_video_credits() using the
    # pricing block when one is set. These fallback flat values are only used
    # when no pricing block exists (e.g. developer-added models without pricing).
    "video": [
        {"id": "vid-wan26",     "label": "Wan 2.6",       "model": "alibaba/wan-2.6",        "credits": 1.0,  "min_duration": 4,  "max_duration": 8},
        {"id": "vid-wan27",     "label": "Wan 2.7",       "model": "alibaba/wan-2.7",        "credits": 2.5,  "min_duration": 8,  "max_duration": 12},
        {"id": "vid-veo31",     "label": "Veo 3.1",       "model": "google/veo-3.1",         "credits": 3.5,  "min_duration": 4,  "max_duration": 8},
        {"id": "vid-klingv3pro","label": "Kling v3.0 Pro","model": "kwaivgi/kling-v3.0-pro", "credits": 4.5,  "min_duration": 10, "max_duration": 15},
    ],
}

MAX_VIDEO_SHOTS = 4  # caps how many shots can be described within the one combined prompt — keeps the prompt (and the resulting instruction to the model) manageable


async def get_available_models(db: AsyncSession) -> dict:
    """The full, current list of image/video/text models, platform-wide."""
    row = await get_config_row(db, "models")
    stored = row.config or {}
    return {
        "text":  stored["text"]  if isinstance(stored.get("text"),  list) and stored["text"]  else list(DEFAULT_MODELS["text"]),
        "image": stored["image"] if isinstance(stored.get("image"), list) and stored["image"] else list(DEFAULT_MODELS["image"]),
        "video": stored["video"] if isinstance(stored.get("video"), list) and stored["video"] else list(DEFAULT_MODELS["video"]),
    }


def get_available_models_sync(db: Session) -> dict:
    """SYNC equivalent — for Celery tasks."""
    row = get_config_row_sync(db, "models")
    stored = row.config or {}
    return {
        "text":  stored["text"]  if isinstance(stored.get("text"),  list) and stored["text"]  else list(DEFAULT_MODELS["text"]),
        "image": stored["image"] if isinstance(stored.get("image"), list) and stored["image"] else list(DEFAULT_MODELS["image"]),
        "video": stored["video"] if isinstance(stored.get("video"), list) and stored["video"] else list(DEFAULT_MODELS["video"]),
    }


async def resolve_model(db: AsyncSession, kind: str, model_id: str) -> dict | None:
    """Looks up ONE specific model by its id (what a customer actually
    picked from the dropdown in Create Ad) — returns its real
    {model, credits, min_duration?, max_duration?}, or None if that id
    no longer exists OR has been disabled (e.g. the developer removed
    or disabled it after the ad was drafted but before it was
    submitted — a disabled model is unavailable for NEW generations the
    same way a deleted one is, even though it stays visible to the
    developer and any ad that already used it keeps working)."""
    models = await get_available_models(db)
    for m in models.get(kind, []):
        if m["id"] == model_id and m.get("enabled", True):
            return m
    return None


def resolve_model_sync(db: Session, kind: str, model_id: str) -> dict | None:
    models = get_available_models_sync(db)
    for m in models.get(kind, []):
        if m["id"] == model_id:
            return m
    return None


async def balance(db: AsyncSession, company_id: uuid.UUID) -> float:
    result = await db.scalar(
        select(func.coalesce(func.sum(CreditLedger.delta), 0))
        .where(CreditLedger.company_id == company_id)
    )
    return float(result or 0)


def _round_to_quarter(value: float) -> float:
    """Round UP to the nearest 0.25, floor 0.25. Mirrors pricing.py's
    version — duplicated here so credits.py has no circular import from
    pricing.py (which itself imports from models/config)."""
    import math
    if value <= 0:
        return 0.25
    quarters = math.ceil(value * 4 - 1e-9)
    return max(1, quarters) / 4


def generation_cost(
    text_credits: float | None,
    image_credits: float | None,
    video_credits: float | None,
    fmt: str,
    variations: int,
    carousel_count: int = 1,
) -> float:
    """Totals the ALREADY-RESOLVED per-generation credit costs.

    Variations note: choosing 3 variations does NOT multiply the cost.
    - Text: one API call regardless — the LLM returns all 3 variants
      in a single response (see tasks._build_prompt). Same cost as 1.
    - Image: one image generation, shared across all variants
      (see tasks.generate_ad — url is assigned to every variant).
    - Video: same, one generation shared.

    The only format that scales by count is carousel (N slides = N
    image calls). Everything else is flat per generation.

    Credits are floats in 0.25 steps — return value is also 0.25-stepped
    with a floor of 0.25."""
    cost: float = 0.0
    if text_credits is not None:
        cost += text_credits
    if image_credits is not None:
        cost += image_credits * max(1, carousel_count) if fmt == "carousel" else image_credits
    if video_credits is not None:
        cost += video_credits
    return _round_to_quarter(max(0.25, cost))
