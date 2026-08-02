"""Dynamic per-combination pricing — computes the real credit cost of a
specific generation (model + resolution + audio + duration for video;
model + resolution for image) from each model's actual OpenRouter cost
structure, rather than a single flat credits number per model.

Design: raw OpenRouter $ cost for the exact combination selected,
marked up by a single global multiplier (developer-configurable,
Developer > Models), converted to credits at credit_value_usd per
credit (developer-configurable, Developer > Settings), rounded to the
nearest 0.25 credits with a floor of 0.25.

Both credit_value_usd AND the markup multiplier are stored in
ModelConfig (DB) and configurable from the developer panel at any time
— useful for promotions (Black Friday etc) or infrastructure cost
changes. The .env CREDIT_VALUE_USD is only the initial fallback used
before the developer has set a value via the panel.

BACKWARD COMPATIBLE: a model entry with no "pricing" key falls back to
its legacy flat "credits" value exactly as before.
"""
import math

from app.config import settings

DEFAULT_MARKUP_MULTIPLIER = 2.5   # 2.5× covers OpenRouter cost + Railway/Vercel infra + profit margin
DEFAULT_CREDIT_VALUE_USD  = 0.10  # $0.10 per credit — matches the public "$0.10 = 1 credit" pricing


# ── DB-backed getters (both values live in ModelConfig "pricing" row) ─────────

async def get_markup_multiplier(db) -> float:
    """Developer-configurable global markup. Stored in ModelConfig
    'pricing' row, falls back to DEFAULT_MARKUP_MULTIPLIER until set."""
    from app.models import get_config_row
    row = await get_config_row(db, "pricing")
    stored = row.config if row and row.config else {}
    pricing_cfg = stored.get("pricing_config") or {}
    value = pricing_cfg.get("markup_multiplier")
    try:
        return float(value) if value else DEFAULT_MARKUP_MULTIPLIER
    except (TypeError, ValueError):
        return DEFAULT_MARKUP_MULTIPLIER


async def get_credit_value_usd(db) -> float:
    """How many USD one credit is worth — developer-configurable so it
    can be changed for promotions without a code deploy. Falls back to
    the .env CREDIT_VALUE_USD (which itself falls back to
    DEFAULT_CREDIT_VALUE_USD = $0.10) until set explicitly via the
    developer panel (Developer > Settings > credit_value_usd)."""
    from app.models import get_config_row
    row = await get_config_row(db, "pricing")
    stored = row.config if row and row.config else {}
    pricing_cfg = stored.get("pricing_config") or {}
    value = pricing_cfg.get("credit_value_usd")
    try:
        v = float(value) if value else None
        return v if v and v > 0 else float(settings.CREDIT_VALUE_USD)
    except (TypeError, ValueError):
        return float(settings.CREDIT_VALUE_USD)


async def set_markup_multiplier(db, multiplier: float) -> None:
    from sqlalchemy.orm.attributes import flag_modified
    from app.models import get_config_row
    row = await get_config_row(db, "pricing")
    config = dict(row.config or {})
    pricing_cfg = dict(config.get("pricing_config") or {})
    pricing_cfg["markup_multiplier"] = multiplier
    config["pricing_config"] = pricing_cfg
    row.config = config
    flag_modified(row, "config")
    await db.commit()


async def set_credit_value_usd(db, credit_value: float) -> None:
    """Persist a new credit_value_usd from the developer panel.
    Also updates the live settings object so the current process
    picks it up immediately without a restart."""
    from sqlalchemy.orm.attributes import flag_modified
    from app.models import get_config_row
    row = await get_config_row(db, "pricing")
    config = dict(row.config or {})
    pricing_cfg = dict(config.get("pricing_config") or {})
    pricing_cfg["credit_value_usd"] = credit_value
    config["pricing_config"] = pricing_cfg
    row.config = config
    flag_modified(row, "config")
    await db.commit()
    # Hot-update the settings object so running processes see the new
    # value immediately (next request) without needing a restart.
    settings.CREDIT_VALUE_USD = credit_value


# ── Core arithmetic ────────────────────────────────────────────────────────────

def _round_to_quarter(value: float) -> float:
    """Round UP to the nearest 0.25, with a floor of 0.25.
    We round UP (ceiling), never down, so we never undercharge on a
    boundary. The 1e-9 epsilon prevents a value that's already an exact
    quarter (e.g. 0.5000000001 due to float arithmetic) from rounding
    up unnecessarily."""
    if value <= 0:
        return 0.25
    quarters = math.ceil(value * 4 - 1e-9)
    return max(1, quarters) / 4   # max(1 quarter) = floor of 0.25


def _usd_to_credits(usd: float, markup: float, credit_value_usd: float) -> float:
    """Convert a raw OpenRouter USD cost to credits:
      1. Apply the developer's markup multiplier
      2. Divide by credit_value_usd to get raw credits
      3. Round UP to nearest 0.25, floor 0.25
    Returns a float (multiple of 0.25), never 0."""
    charged_usd = usd * markup
    raw_credits = charged_usd / credit_value_usd
    return _round_to_quarter(raw_credits)


# ── Per-kind compute functions ─────────────────────────────────────────────────

def compute_text_credits(model_entry: dict, markup: float, credit_value_usd: float) -> float:
    """Text generations are a goodwill-floor 0.25 credits — the real
    per-call cost ($0.001) is negligible but we charge a small amount
    so credits still feel meaningful. If a model ever gets a real
    'pricing' block with cost_usd, it uses the full dynamic calculation.
    Returns a float multiple of 0.25."""
    pricing = model_entry.get("pricing")
    if not pricing or "cost_usd" not in pricing:
        # Flat value stored in model entry (legacy or developer-set).
        # If it's already a round integer like 1, honour it; otherwise
        # fall back to the 0.25 goodwill floor.
        flat = model_entry.get("credits")
        if flat is not None:
            try:
                v = float(flat)
                return _round_to_quarter(v) if v > 0 else 0.25
            except (TypeError, ValueError):
                pass
        return 0.25   # goodwill floor
    return _usd_to_credits(float(pricing["cost_usd"]), markup, credit_value_usd)


def compute_image_credits(model_entry: dict, markup: float, credit_value_usd: float) -> float:
    """Image pricing: flat $/image from the model's pricing block.
    Falls back to the legacy flat credits value if no pricing block.
    Returns a float multiple of 0.25."""
    pricing = model_entry.get("pricing")
    if not pricing or "cost_usd" not in pricing:
        flat = model_entry.get("credits", 2)
        try:
            v = float(flat)
            return _round_to_quarter(v) if v > 0 else 0.25
        except (TypeError, ValueError):
            return 0.25
    return _usd_to_credits(float(pricing["cost_usd"]), markup, credit_value_usd)


def compute_video_credits(
    model_entry: dict,
    resolution: str | None,
    audio: bool,
    duration_seconds: int,
    markup: float,
    credit_value_usd: float,
    has_reference_image: bool = False,
) -> float:
    """Video pricing: per-second rate × duration, with optional
    image-to-video surcharge. Falls back to legacy flat credits.
    Returns a float multiple of 0.25."""
    pricing = model_entry.get("pricing")
    if not pricing or "rates_usd_per_second" not in pricing:
        flat = model_entry.get("credits", 3)
        try:
            v = float(flat)
            return _round_to_quarter(v) if v > 0 else 0.25
        except (TypeError, ValueError):
            return 0.25

    rate_table_key = (
        "rates_usd_per_second_image_to_video"
        if (has_reference_image and "rates_usd_per_second_image_to_video" in pricing)
        else "rates_usd_per_second"
    )
    rates = pricing[rate_table_key]

    tier = rates.get(resolution) if resolution else None
    if tier is None:
        tier = next(iter(rates.values()), None)
    if tier is None:
        flat = model_entry.get("credits", 3)
        return _round_to_quarter(float(flat)) if flat else 0.25

    if isinstance(tier, dict):
        supports_audio_toggle = pricing.get("supports_audio", True)
        want_key = "audio" if (audio or not supports_audio_toggle) else "no_audio"
        if want_key in tier:
            rate = tier[want_key]
        elif tier:
            rate = next(iter(tier.values()))
        else:
            return _round_to_quarter(float(model_entry.get("credits", 3)))
    else:
        rate = float(tier)

    try:
        raw_cost = float(rate) * duration_seconds
        if has_reference_image:
            raw_cost += float(pricing.get("reference_image_input_cost_usd", 0) or 0)
    except (TypeError, ValueError):
        return _round_to_quarter(float(model_entry.get("credits", 3)))

    return _usd_to_credits(raw_cost, markup, credit_value_usd)
