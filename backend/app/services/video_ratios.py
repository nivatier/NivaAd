"""Developer-managed list of available aspect ratios — ratio strings
(e.g. "1:1", "9:16") with optional per-platform applicability.

Each ratio is stored as {"ratio": "9:16", "platforms": ["tiktok", ...]}
Existing plain-string ratios are migrated on read to default to all
platforms — no DB migration needed.

Actual target dimensions are computed per-generation from the source
media's own resolution (see services/reframe.py).
Reuses the same ModelConfig JSON blob all other developer settings use.
"""
from sqlalchemy.orm.attributes import flag_modified

from app.models import ModelConfig, get_config_row, get_config_row_sync

DEFAULT_PLATFORMS = [
    "linkedin_personal", "linkedin_company",
    "facebook", "instagram", "tiktok", "threads", "x",
]

DEFAULT_RATIOS = [
    {"ratio": "1:1",    "platforms": list(DEFAULT_PLATFORMS)},
    {"ratio": "9:16",   "platforms": ["tiktok", "instagram", "threads", "facebook"]},
    {"ratio": "16:9",   "platforms": ["linkedin_personal", "linkedin_company", "x"]},
    {"ratio": "1.91:1", "platforms": ["facebook", "linkedin_personal", "linkedin_company"]},
    {"ratio": "4:5",    "platforms": ["instagram", "facebook"]},
]

FALLBACK_RATIO = "1:1"


def _normalise(raw: list) -> list[dict]:
    """Ensure every entry is a dict with ratio + platforms.
    Migrates legacy plain strings to all-platform dicts on read.
    """
    result = []
    for item in raw:
        if isinstance(item, str):
            result.append({"ratio": item, "platforms": list(DEFAULT_PLATFORMS)})
        elif isinstance(item, dict) and "ratio" in item:
            result.append({
                "ratio": item["ratio"],
                "platforms": item.get("platforms", list(DEFAULT_PLATFORMS)),
            })
    return result


async def get_aspect_ratios(db) -> list[dict]:
    """Return list of {ratio, platforms} dicts."""
    row = await get_config_row(db, "platform")
    stored = row.config if row and row.config else {}
    raw = stored.get("video_ratios")
    if isinstance(raw, list) and raw:
        return _normalise(raw)
    return [dict(r) for r in DEFAULT_RATIOS]


async def get_video_ratios(db) -> list[str]:
    """Backward-compatible: return just the ratio strings."""
    ratios = await get_aspect_ratios(db)
    return [r["ratio"] for r in ratios]


def get_video_ratios_sync(db) -> list[str]:
    """SYNC equivalent — for use inside Celery tasks."""
    row = get_config_row_sync(db, "platform")
    stored = row.config if row and row.config else {}
    raw = stored.get("video_ratios")
    if isinstance(raw, list) and raw:
        return [r["ratio"] if isinstance(r, dict) else r for r in raw]
    return [r["ratio"] for r in DEFAULT_RATIOS]


async def add_video_ratio(
    db, ratio: str, platforms: list[str] | None = None
) -> list[dict]:
    ratios = await get_aspect_ratios(db)
    if not any(r["ratio"] == ratio for r in ratios):
        ratios.append({
            "ratio": ratio,
            "platforms": platforms if platforms is not None else list(DEFAULT_PLATFORMS),
        })
        await _save(db, ratios)
    return ratios


async def update_ratio_platforms(
    db, ratio: str, platforms: list[str]
) -> list[dict]:
    """Update which platforms a ratio applies to."""
    ratios = await get_aspect_ratios(db)
    for r in ratios:
        if r["ratio"] == ratio:
            r["platforms"] = platforms
            break
    await _save(db, ratios)
    return ratios


async def remove_video_ratio(db, ratio: str) -> list[dict]:
    ratios = await get_aspect_ratios(db)
    ratios = [r for r in ratios if r["ratio"] != ratio]
    await _save(db, ratios)
    return ratios


async def _save(db, ratios: list[dict]) -> None:
    row = await get_config_row(db, "platform")
    config = dict(row.config or {})
    config["video_ratios"] = ratios
    row.config = config
    flag_modified(row, "config")
    await db.commit()


def resolve_ratio(ratio: str | None, available_ratios: list[str]) -> str:
    """Silently falls back to FALLBACK_RATIO when the given ratio no
    longer exists in the current list."""
    if ratio and ratio in available_ratios:
        return ratio
    if FALLBACK_RATIO in available_ratios:
        return FALLBACK_RATIO
    return available_ratios[0] if available_ratios else FALLBACK_RATIO


async def check_ratio_usage(db, ratio: str) -> dict:
    """What's currently referencing this ratio — for the warn-before-delete flow."""
    from sqlalchemy import select
    from app.models import BrandKit
    from app.services import platform_config

    platforms = await platform_config.get_platform_integrations(db)
    platform_labels = [p["label"] for p in platforms if p.get("video_ratio") == ratio]

    kits = (await db.scalars(select(BrandKit))).all()
    company_count = sum(
        1 for k in kits
        if (k.platform_ratio_overrides or {}).values().__contains__(ratio)
    )

    return {"platforms": platform_labels, "company_override_count": company_count}
