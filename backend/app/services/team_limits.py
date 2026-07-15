"""Developer-configurable cap on team size — how many non-admin members
(editor/poster role) a single company can add on top of its admin(s).
Reuses the same ModelConfig JSON blob the model list, platform
integrations, and pricing markup already live in — no migration
needed.
"""
from sqlalchemy.orm.attributes import flag_modified

from app.models import ModelConfig

DEFAULT_MAX_EXTRA_USERS = 2


async def get_max_extra_users(db) -> int:
    """Defaults to 2 until the developer sets one explicitly. Applied
    globally, the same limit for every company — not a per-company
    override (that's a reasonable future extension if a tiered-plan
    model comes later, but isn't what was asked for here)."""
    row = await db.get(ModelConfig, 1)
    stored = row.config if row and row.config else {}
    team_cfg = stored.get("team_limits") or {}
    value = team_cfg.get("max_extra_users")
    try:
        return int(value) if value is not None else DEFAULT_MAX_EXTRA_USERS
    except (TypeError, ValueError):
        return DEFAULT_MAX_EXTRA_USERS


async def set_max_extra_users(db, max_extra_users: int) -> None:
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    team_cfg = dict(config.get("team_limits") or {})
    team_cfg["max_extra_users"] = max_extra_users
    config["team_limits"] = team_cfg
    row.config = config
    flag_modified(row, "config")
    await db.commit()
