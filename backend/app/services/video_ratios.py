"""Developer-managed list of available video/image aspect ratios — just
the ratio strings themselves (e.g. "1:1", "9:16"), not fixed pixel
sizes. Actual target dimensions are computed per-generation from the
source media's own resolution (see services/reframe.py). Reuses the
same ModelConfig JSON blob everything else in this app's developer
settings lives in — no migration needed.
"""
from sqlalchemy.orm.attributes import flag_modified

from app.models import ModelConfig

DEFAULT_RATIOS = ["1:1", "9:16", "16:9", "1.91:1", "4:5"]
FALLBACK_RATIO = "1:1"  # used whenever a stored ratio (a platform's video_ratio, or a company's override) no longer exists in the current list — silently falls back rather than erroring, per the agreed design


async def get_video_ratios(db) -> list[str]:
    row = await db.get(ModelConfig, 1)
    stored = row.config if row and row.config else {}
    raw = stored.get("video_ratios")
    return list(raw) if isinstance(raw, list) and raw else list(DEFAULT_RATIOS)


def get_video_ratios_sync(db) -> list[str]:
    """SYNC equivalent — for use inside Celery tasks."""
    row = db.get(ModelConfig, 1)
    stored = row.config if row and row.config else {}
    raw = stored.get("video_ratios")
    return list(raw) if isinstance(raw, list) and raw else list(DEFAULT_RATIOS)


async def add_video_ratio(db, ratio: str) -> list[str]:
    ratios = await get_video_ratios(db)
    if ratio not in ratios:
        ratios.append(ratio)
        await _save(db, ratios)
    return ratios


async def remove_video_ratio(db, ratio: str) -> list[str]:
    ratios = await get_video_ratios(db)
    ratios = [r for r in ratios if r != ratio]
    await _save(db, ratios)
    return ratios


async def _save(db, ratios: list[str]) -> None:
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    config["video_ratios"] = ratios
    row.config = config
    flag_modified(row, "config")
    await db.commit()


def resolve_ratio(ratio: str | None, available_ratios: list[str]) -> str:
    """Silently falls back to FALLBACK_RATIO (or the first available
    ratio if that's also gone) whenever the given ratio no longer
    exists in the developer's current list — e.g. a platform or a
    company override still referencing a ratio that's since been
    deleted. Never raises — a stale reference degrades gracefully
    rather than breaking generation."""
    if ratio and ratio in available_ratios:
        return ratio
    if FALLBACK_RATIO in available_ratios:
        return FALLBACK_RATIO
    return available_ratios[0] if available_ratios else FALLBACK_RATIO


async def check_ratio_usage(db, ratio: str) -> dict:
    """What's currently referencing this ratio — powers the "warn
    before deletion" flow. Deletion itself is never blocked (per the
    agreed design: warn, don't block, silently fall back for anything
    still referencing it afterward) — this is purely informational, so
    the developer can make an informed choice before confirming."""
    from sqlalchemy import select
    from app.models import BrandKit
    from app.services import platform_config

    platforms = await platform_config.get_platform_integrations(db)
    platform_labels = [p["label"] for p in platforms if p.get("video_ratio") == ratio]

    kits = (await db.scalars(select(BrandKit))).all()
    company_count = sum(1 for k in kits if (k.platform_ratio_overrides or {}).values().__contains__(ratio))

    return {"platforms": platform_labels, "company_override_count": company_count}
