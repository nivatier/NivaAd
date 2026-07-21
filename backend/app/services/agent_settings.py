"""Agent Niva's platform-wide default policy — three developer-set
switches (see routers/developer.py's /developer/agent-settings and the
Developer > Agent Niva tab), same ModelConfig(id=1).config singleton
pattern used for video ratios, retention windows, etc. Not per-company:
one policy for the whole platform, same as those other settings.
"""
from sqlalchemy.orm.attributes import flag_modified

from app.models import ModelConfig

DEFAULT_AGENT_SETTINGS = {
    # Quick Start: what happens after the AI recommends N ad ideas from a scraped site.
    # "review_first"   — show the recommendations, customer clicks to create each one (default)
    # "auto_draft"      — all N created as draft ads immediately, customer reviews after in My Ads
    # "auto_schedule"   — generated AND scheduled immediately, no review step
    "quick_start_mode": "review_first",
    # Recurring events: who approves an agent-generated event ad before it posts.
    # "draft_only"      — generated as a draft only, customer schedules/posts manually (default)
    # "schedule_review" — generated AND scheduled for the event date, but stays cancellable up to then
    # "auto_post"       — fully automatic, no human step
    "event_approval_mode": "draft_only",
    # Credit spend cap for agent-generated ads (Quick Start creates + event-triggered generations).
    # "monthly_budget"  — enforce monthly_credit_budget per company (default)
    # "confirm_each_time" — no automatic cap; each spend just needs to pass the normal balance check
    # "none"            — no cap at all beyond the normal balance check
    "credit_cap_mode": "monthly_budget",
    "monthly_credit_budget": 200,
}


async def get_agent_settings(db) -> dict:
    row = await db.get(ModelConfig, 1)
    stored = (row.config.get("agent_settings") if row and row.config else None) or {}
    return {**DEFAULT_AGENT_SETTINGS, **stored}


def get_agent_settings_sync(db) -> dict:
    """SYNC equivalent — for use inside Celery tasks."""
    row = db.get(ModelConfig, 1)
    stored = (row.config.get("agent_settings") if row and row.config else None) or {}
    return {**DEFAULT_AGENT_SETTINGS, **stored}


async def update_agent_settings(db, updates: dict) -> dict:
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    current = {**DEFAULT_AGENT_SETTINGS, **(config.get("agent_settings") or {})}
    current.update({k: v for k, v in updates.items() if v is not None})
    config["agent_settings"] = current
    row.config = config
    flag_modified(row, "config")
    await db.commit()
    return current
