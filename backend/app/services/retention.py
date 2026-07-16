"""Developer-configurable media retention period — how long generated
images/videos stay in storage before being automatically removed
(Option B, agreed with the developer: media files are deleted, but the
ad's caption/metadata/analytics data stays forever — only the
attachments go away). Same storage pattern as the markup multiplier
and team size limit — reuses the ModelConfig JSON blob, no migration
needed.

This ONE number drives both the cleanup job (tasks.cleanup_expired_media)
and the scheduling cap (schedule.py/campaigns.py validate a scheduled
date against ad.created_at + this period) — they read the same value so
they can never drift apart.
"""
from sqlalchemy.orm.attributes import flag_modified

from app.models import ModelConfig

DEFAULT_RETENTION_MONTHS = 6


async def get_retention_months(db) -> int:
    row = await db.get(ModelConfig, 1)
    stored = row.config if row and row.config else {}
    retention_cfg = stored.get("retention") or {}
    value = retention_cfg.get("months")
    try:
        return int(value) if value else DEFAULT_RETENTION_MONTHS
    except (TypeError, ValueError):
        return DEFAULT_RETENTION_MONTHS


def get_retention_months_sync(db) -> int:
    """SYNC equivalent — for use inside Celery tasks (tasks.py), which
    run on a sync SQLAlchemy session/engine, same reasoning as
    credits.get_available_models_sync."""
    row = db.get(ModelConfig, 1)
    stored = row.config if row and row.config else {}
    retention_cfg = stored.get("retention") or {}
    value = retention_cfg.get("months")
    try:
        return int(value) if value else DEFAULT_RETENTION_MONTHS
    except (TypeError, ValueError):
        return DEFAULT_RETENTION_MONTHS


async def validate_schedule_within_retention(db, ad_created_at, scheduled_at) -> None:
    """Enforces the scheduling cap agreed with the developer: a post can
    never be scheduled past its OWN ad's retention cutoff
    (created_at + retention period) — anchored to the ad's creation
    date, not "today", which is what makes a still-pending scheduled
    post outliving its ad's media structurally impossible, not just
    unlikely. Raises HTTPException directly (imported lazily to avoid a
    circular import at module load time) so every call site gets the
    same message for free."""
    from datetime import timedelta
    from fastapi import HTTPException
    months = await get_retention_months(db)
    cutoff = ad_created_at + timedelta(days=months * 30)
    if scheduled_at > cutoff:
        raise HTTPException(
            422,
            f"This ad's media is only kept for {months} months from when it was created — "
            f"the latest you can schedule it is {cutoff.strftime('%b %d, %Y')}. Pick an earlier date, "
            f"or generate a fresh ad if you need it further out.",
        )


async def set_retention_months(db, months: int) -> None:
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    retention_cfg = dict(config.get("retention") or {})
    retention_cfg["months"] = months
    config["retention"] = retention_cfg
    row.config = config
    flag_modified(row, "config")
    await db.commit()


# Separate, longer-horizon retention for the AD RECORD ITSELF — not just
# its media. Media retention (above) is Option B: strip the files,
# keep the ad forever for analytics/history. This is different and
# more destructive on purpose: once a post is older than this, the
# WHOLE row is deleted — caption, metadata, everything — to actually
# bound database growth over the long run, since Option B alone means
# the ads table grows forever even with media long since cleaned up.
DEFAULT_POST_RETENTION_MONTHS = 24  # 2 years


async def get_post_retention_months(db) -> int:
    row = await db.get(ModelConfig, 1)
    stored = row.config if row and row.config else {}
    retention_cfg = stored.get("retention") or {}
    value = retention_cfg.get("post_months")
    try:
        return int(value) if value else DEFAULT_POST_RETENTION_MONTHS
    except (TypeError, ValueError):
        return DEFAULT_POST_RETENTION_MONTHS


def get_post_retention_months_sync(db) -> int:
    """SYNC equivalent — for use inside Celery tasks."""
    row = db.get(ModelConfig, 1)
    stored = row.config if row and row.config else {}
    retention_cfg = stored.get("retention") or {}
    value = retention_cfg.get("post_months")
    try:
        return int(value) if value else DEFAULT_POST_RETENTION_MONTHS
    except (TypeError, ValueError):
        return DEFAULT_POST_RETENTION_MONTHS


async def set_post_retention_months(db, months: int) -> None:
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    retention_cfg = dict(config.get("retention") or {})
    retention_cfg["post_months"] = months
    config["retention"] = retention_cfg
    row.config = config
    flag_modified(row, "config")
    await db.commit()
