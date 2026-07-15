"""Dynamic per-combination pricing — computes the real credit cost of a
specific generation (model + resolution + audio + duration for video;
model + resolution for image) from each model's actual OpenRouter cost
structure, rather than a single flat credits number per model.

Design agreed with the developer: raw OpenRouter $ cost for the exact
combination selected, marked up by a single global multiplier (developer-
configurable, Developer > Models), converted to credits at
settings.CREDIT_VALUE_USD per credit, rounded to a whole credit with a
floor of 1 (credits are stored as integers — no fractional-credit
billing).

BACKWARD COMPATIBLE: a model entry with no "pricing" key falls back to
its legacy flat "credits" value exactly as before — nothing breaks for
models that haven't been given a real pricing structure yet. Adding a
"pricing" block is what opts a model into dynamic, combination-aware
pricing.
"""
import math

from app.config import settings

DEFAULT_MARKUP_MULTIPLIER = 1.7  # the middle of the agreed 1.6-1.8x range


async def get_markup_multiplier(db) -> float:
    """Developer-configurable, stored the same way the model list and
    platform integrations are — reuses the ModelConfig JSON blob, no
    migration needed. Falls back to DEFAULT_MARKUP_MULTIPLIER until the
    developer sets one explicitly."""
    from app.models import ModelConfig
    row = await db.get(ModelConfig, 1)
    stored = row.config if row and row.config else {}
    pricing_cfg = stored.get("pricing_config") or {}
    value = pricing_cfg.get("markup_multiplier")
    try:
        return float(value) if value else DEFAULT_MARKUP_MULTIPLIER
    except (TypeError, ValueError):
        return DEFAULT_MARKUP_MULTIPLIER


async def set_markup_multiplier(db, multiplier: float) -> None:
    from sqlalchemy.orm.attributes import flag_modified
    from app.models import ModelConfig
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    pricing_cfg = dict(config.get("pricing_config") or {})
    pricing_cfg["markup_multiplier"] = multiplier
    config["pricing_config"] = pricing_cfg
    row.config = config
    flag_modified(row, "config")
    await db.commit()


def _usd_to_credits(usd: float, markup: float) -> int:
    charged_usd = usd * markup
    credits = charged_usd / settings.CREDIT_VALUE_USD
    return max(1, math.ceil(credits - 1e-9))  # round UP, not to nearest — never undercharge on a boundary; 1 credit minimum


def compute_image_credits(model_entry: dict, markup: float) -> int:
    """Image pricing is simpler than video — a flat $/image cost is
    enough for every model on the list so far (none of them are
    resolution-tiered in a way that matters at the credit-rounding
    granularity we're using). Falls back to the legacy flat credits
    value if no "pricing" block is present."""
    pricing = model_entry.get("pricing")
    if not pricing or "cost_usd" not in pricing:
        return int(model_entry.get("credits", 2))
    return _usd_to_credits(float(pricing["cost_usd"]), markup)


def compute_video_credits(model_entry: dict, resolution: str | None, audio: bool, duration_seconds: int, markup: float) -> int:
    """Looks up this model's rate for the given resolution + audio
    setting, multiplies by duration, marks up, converts to credits.
    Falls back to the legacy flat credits value if no "pricing" block is
    present."""
    pricing = model_entry.get("pricing")
    if not pricing or "rates_usd_per_second" not in pricing:
        return int(model_entry.get("credits", 3))

    rates = pricing["rates_usd_per_second"]
    # Resolution lookup: use the requested one if the model has a rate
    # for it, otherwise fall back to whatever resolution IS priced
    # (handles a stale/mismatched resolution selection gracefully rather
    # than raising).
    tier = rates.get(resolution) if resolution else None
    if tier is None:
        tier = next(iter(rates.values()), None)
    if tier is None:
        return int(model_entry.get("credits", 3))

    if isinstance(tier, dict):
        # Audio-tiered: {"audio": x, "no_audio": y}. If the model doesn't
        # actually support turning audio off (supports_audio: False),
        # audio is effectively always "on" for pricing purposes.
        supports_audio_toggle = pricing.get("supports_audio", True)
        rate = tier.get("audio" if (audio or not supports_audio_toggle) else "no_audio", next(iter(tier.values())))
    else:
        rate = float(tier)

    raw_cost = rate * duration_seconds
    return _usd_to_credits(raw_cost, markup)
