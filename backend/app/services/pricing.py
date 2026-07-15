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


def compute_text_credits(model_entry: dict, markup: float) -> int:
    """Text is priced the same way image is — but since none of the
    seeded text models have a "pricing" block with a real per-call $
    cost wired up yet (their actual OpenRouter cost is a fraction of a
    cent regardless of which one you pick), this currently just returns
    the flat "credits" value set in Developer > Models. Structured
    identically to compute_image_credits so a real cost_usd can be added
    per model later without changing any call site."""
    pricing = model_entry.get("pricing")
    if not pricing or "cost_usd" not in pricing:
        return int(model_entry.get("credits", 1))
    return _usd_to_credits(float(pricing["cost_usd"]), markup)


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


def compute_video_credits(model_entry: dict, resolution: str | None, audio: bool, duration_seconds: int, markup: float, has_reference_image: bool = False) -> int:
    """Looks up this model's rate for the given resolution + audio
    setting, multiplies by duration, marks up, converts to credits.
    Falls back to the legacy flat credits value if no "pricing" block is
    present.

    has_reference_image drives two real, separately-priceable things a
    model's pricing block can now express:
      - rates_usd_per_second_image_to_video: a SECOND rate table, used
        instead of the base one when a reference/frame image is
        provided (some models, e.g. Wan 2.6, genuinely charge more for
        image-to-video than text-to-video). Falls back to the base
        table if this model doesn't define a separate one.
      - reference_image_input_cost_usd: a flat per-generation charge
        added on top of the per-second cost when a reference image is
        provided (e.g. Grok Imagine's $0.002/image input fee) —
        independent of which rate table is used.
    """
    pricing = model_entry.get("pricing")
    if not pricing or "rates_usd_per_second" not in pricing:
        return int(model_entry.get("credits", 3))

    rate_table_key = "rates_usd_per_second_image_to_video" if (has_reference_image and "rates_usd_per_second_image_to_video" in pricing) else "rates_usd_per_second"
    rates = pricing[rate_table_key]
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
        want_key = "audio" if (audio or not supports_audio_toggle) else "no_audio"
        if want_key in tier:
            rate = tier[want_key]
        elif tier:
            # Incomplete entry (e.g. only one of audio/no_audio filled
            # in while the developer is still editing) — use whatever
            # IS there rather than crash. dict.get()'s default argument
            # evaluates eagerly even when unused, so this can't be a
            # one-liner .get() with next(iter(...)) as the fallback —
            # that blew up on an empty tier regardless of whether "audio"
            # was actually present.
            rate = next(iter(tier.values()))
        else:
            # Genuinely empty rate entry for this resolution — nothing
            # usable here at all, fall back to the legacy flat credits
            # rather than raise.
            return int(model_entry.get("credits", 3))
    else:
        rate = float(tier)

    try:
        raw_cost = float(rate) * duration_seconds
        if has_reference_image:
            raw_cost += float(pricing.get("reference_image_input_cost_usd", 0) or 0)
    except (TypeError, ValueError):
        return int(model_entry.get("credits", 3))
    return _usd_to_credits(raw_cost, markup)
