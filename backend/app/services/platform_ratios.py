"""Developer-configurable target aspect ratio per platform — what the
reframe pipeline (services/reframe.py) treats as each platform's
required ratio. Reuses the same ModelConfig JSON blob pattern as
markup/retention/team-limits, no migration needed.

Defaults match the ratios already shown as informational labels in the
frontend's PLATFORMS list, so nothing changes for an existing install
until the developer actually edits one.
"""
from sqlalchemy.orm.attributes import flag_modified

from app.models import ModelConfig

VALID_RATIOS = {"1:1", "9:16", "16:9", "1.91:1", "4:5"}

DEFAULT_PLATFORM_RATIOS = {
    "instagram": "1:1",
    "facebook": "1.91:1",
    "linkedin": "1.91:1",
    "x": "16:9",
    "tiktok": "9:16",
}


async def get_platform_ratios(db) -> dict:
    row = await db.get(ModelConfig, 1)
    stored = row.config if row and row.config else {}
    raw = stored.get("platform_ratios")
    if isinstance(raw, dict) and raw:
        # Merge, not replace — same reasoning as the platform integrations
        # seed: a newly added platform (or one added to DEFAULT_PLATFORM_RATIOS
        # after the developer already customized others) should still show
        # up, not be silently missing just because SOME ratios were already
        # configured.
        return {**DEFAULT_PLATFORM_RATIOS, **raw}
    return dict(DEFAULT_PLATFORM_RATIOS)


def get_platform_ratios_sync(db) -> dict:
    """SYNC equivalent — for use inside Celery tasks."""
    row = db.get(ModelConfig, 1)
    stored = row.config if row and row.config else {}
    raw = stored.get("platform_ratios")
    if isinstance(raw, dict) and raw:
        return {**DEFAULT_PLATFORM_RATIOS, **raw}
    return dict(DEFAULT_PLATFORM_RATIOS)


async def set_platform_ratio(db, platform_id: str, ratio: str) -> None:
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    ratios = dict(config.get("platform_ratios") or DEFAULT_PLATFORM_RATIOS)
    ratios[platform_id] = ratio
    config["platform_ratios"] = ratios
    row.config = config
    flag_modified(row, "config")
    await db.commit()
