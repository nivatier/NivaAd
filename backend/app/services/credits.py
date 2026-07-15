import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.models import CreditLedger, ModelConfig

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
        {"id": "txt-gemini", "label": "Gemini 2.5 Flash", "model": "google/gemini-2.5-flash", "credits": 1},
        {"id": "txt-haiku", "label": "Claude Haiku 4.5", "model": "anthropic/claude-haiku-4.5", "credits": 1},
        {"id": "txt-deepseek", "label": "DeepSeek V4 Flash", "model": "deepseek/deepseek-v4-flash", "credits": 1},
    ],
    "image": [
        # Credits DOUBLED 2026-07-15 to match the CREDIT_VALUE_USD re-peg
        # ($0.90 -> $0.45) — preserves the same real dollar price per
        # generation as before the re-peg (1 credit now buys half as much,
        # so it takes twice as many credits to equal the same $ amount).
        {"id": "img-fast", "label": "GPT Image 1 Mini", "model": "openai/gpt-image-1-mini", "credits": 2},
        {"id": "img-balanced", "label": "Gemini 2.5 Flash Image", "model": "google/gemini-2.5-flash-image", "credits": 4},
        # FIXED 2026-07-12: black-forest-labs/flux-1.1-pro 404'd with
        # "No model found" on a real generation attempt — confirmed via
        # OpenRouter's own announcement that the line moved to FLUX.2.
        {"id": "img-premium", "label": "FLUX.2 Pro", "model": "black-forest-labs/flux.2-pro", "credits": 6},
    ],
    # REPLACED 2026-07-12: Sora 2 Pro was dropped after real testing — a
    # 20-second request timed out (480s), the automatic text-to-video
    # fallback ALSO timed out (~520s more), and OpenRouter still billed
    # ~$6 for the failed attempt. Not reliable enough to keep.
    #
    # Durations verified against OpenRouter's own model pages (not
    # picked arbitrarily):
    #   Wan 2.6        — confirmed up to 15s
    #   Wan 2.7        — confirmed up to 15s ("3x longer than earlier Wan models")
    #   Veo 3.1        — CAVEAT: only accepts EXACT discrete durations
    #                    (4, 6, or 8s), unlike the others which accept a
    #                    continuous range. Bounds set tightly (4-8s) to
    #                    minimize mismatches, but a request for e.g. 7s
    #                    could still fail — worth building real
    #                    discrete-value support for this one if it
    #                    becomes a problem.
    #   Kling v3.0 Pro — confirmed 3-15s.
    #
    # Credits DOUBLED 2026-07-15, same re-peg reasoning as image above.
    "video": [
        {"id": "vid-wan26", "label": "Wan 2.6", "model": "alibaba/wan-2.6", "credits": 6, "min_duration": 4, "max_duration": 8},
        {"id": "vid-wan27", "label": "Wan 2.7", "model": "alibaba/wan-2.7", "credits": 10, "min_duration": 8, "max_duration": 12},
        {"id": "vid-veo31", "label": "Veo 3.1", "model": "google/veo-3.1", "credits": 14, "min_duration": 4, "max_duration": 8},
        {"id": "vid-klingv3pro", "label": "Kling v3.0 Pro", "model": "kwaivgi/kling-v3.0-pro", "credits": 18, "min_duration": 10, "max_duration": 15},
    ],
}

MAX_VIDEO_SHOTS = 4  # caps how many shots can be described within the one combined prompt — keeps the prompt (and the resulting instruction to the model) manageable


async def get_available_models(db: AsyncSession) -> dict:
    """The full, current list of image/video models, platform-wide —
    editable only by the developer. Seeds from DEFAULT_MODELS the first
    time (if nothing's been stored yet); once ANY edit has been made,
    the stored list is authoritative and DEFAULT_MODELS is never
    consulted again."""
    row = await db.get(ModelConfig, 1)
    stored = row.config if row and row.config else {}
    return {
        "text": stored["text"] if isinstance(stored.get("text"), list) and stored["text"] else list(DEFAULT_MODELS["text"]),
        "image": stored["image"] if isinstance(stored.get("image"), list) and stored["image"] else list(DEFAULT_MODELS["image"]),
        "video": stored["video"] if isinstance(stored.get("video"), list) and stored["video"] else list(DEFAULT_MODELS["video"]),
    }


def get_available_models_sync(db: Session) -> dict:
    """SYNC equivalent of get_available_models — for use inside Celery
    tasks (tasks.py), which run on a sync SQLAlchemy session/engine."""
    row = db.get(ModelConfig, 1)
    stored = row.config if row and row.config else {}
    return {
        "text": stored["text"] if isinstance(stored.get("text"), list) and stored["text"] else list(DEFAULT_MODELS["text"]),
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


async def balance(db: AsyncSession, company_id: uuid.UUID) -> int:
    return (await db.scalar(
        select(func.coalesce(func.sum(CreditLedger.delta), 0))
        .where(CreditLedger.company_id == company_id)
    )) or 0


def generation_cost(text_credits: int | None, image_credits: int | None, video_credits: int | None, fmt: str, variations: int, carousel_count: int = 1) -> int:
    """Takes the ALREADY-RESOLVED per-generation credit costs for
    whichever specific models were chosen (see resolve_model) — this
    function is now just arithmetic, not model lookup, since that
    happens once per request in the caller. carousel_count is only
    meaningful when fmt == "carousel" — a carousel with N images
    genuinely costs N real image-generation calls, so it's priced
    per-image. Video is different: a multi-shot video is still ONE real
    generation call (shots are combined into a single prompt with
    timing markers, see tasks.py), so video cost is flat regardless of
    shot count, unlike carousel. Text is flat too — one copy-generation
    call regardless of format."""
    cost = 0
    if text_credits is not None:
        cost += text_credits
    if image_credits is not None:
        cost += image_credits * max(1, carousel_count) if fmt == "carousel" else image_credits
    if video_credits is not None:
        cost += video_credits
    cost = max(1, cost)
    if variations == 3:
        cost *= 2
    return cost
