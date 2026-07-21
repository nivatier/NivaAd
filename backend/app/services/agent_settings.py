"""Agent Niva policy settings — stored per-company so each company's
admin can configure their own Quick Start mode, event approval mode,
and credit spend cap independently.

Pattern mirrors CompanyModelConfig exactly:
  - one row per company in `company_agent_settings` (unique company_id FK)
  - JSON `config` column
  - falls back to DEFAULT_AGENT_SETTINGS when the row doesn't exist yet
    or a key is absent (e.g. companies that existed before this feature)

The old platform-wide version stored everything in ModelConfig(id=1).config
["agent_settings"]. That singleton is no longer written or read here.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.models import CompanyAgentSettings

DEFAULT_AGENT_SETTINGS = {
    # Quick Start: what happens after the AI recommends N ad ideas from a scraped site.
    # "review_first"   — show the recommendations, customer clicks to create each one (default)
    # "auto_draft"     — all N created as draft ads immediately, customer reviews after in My Ads
    # "auto_schedule"  — generated AND scheduled immediately, no review step
    "quick_start_mode": "review_first",
    # Recurring events: who approves an agent-generated event ad before it posts.
    # "draft_only"     — generated as a draft only, customer schedules/posts manually (default)
    # "schedule_review"— generated AND scheduled for the event date, but stays cancellable up to then
    # "auto_post"      — fully automatic, no human step
    "event_approval_mode": "draft_only",
    # Credit spend cap for agent-generated ads.
    # "monthly_budget" — enforce monthly_credit_budget per company (default)
    # "confirm_each_time" — no automatic cap; each spend just needs the normal balance check
    # "none"           — no cap at all beyond the normal balance check
    "credit_cap_mode": "monthly_budget",
    "monthly_credit_budget": 200,
}


async def get_agent_settings(db, company_id: uuid.UUID) -> dict:
    row = await db.scalar(
        select(CompanyAgentSettings).where(CompanyAgentSettings.company_id == company_id)
    )
    stored = (row.config if row and row.config else None) or {}
    return {**DEFAULT_AGENT_SETTINGS, **stored}


def get_agent_settings_sync(db, company_id: uuid.UUID) -> dict:
    """SYNC equivalent — for use inside Celery tasks."""
    from sqlalchemy import select as sa_select
    row = db.scalar(
        sa_select(CompanyAgentSettings).where(CompanyAgentSettings.company_id == company_id)
    )
    stored = (row.config if row and row.config else None) or {}
    return {**DEFAULT_AGENT_SETTINGS, **stored}


async def update_agent_settings(db, company_id: uuid.UUID, updates: dict) -> dict:
    row = await db.scalar(
        select(CompanyAgentSettings).where(CompanyAgentSettings.company_id == company_id)
    )
    if row is None:
        row = CompanyAgentSettings(company_id=company_id, config={})
        db.add(row)
        await db.flush()
    current = {**DEFAULT_AGENT_SETTINGS, **(row.config or {})}
    current.update({k: v for k, v in updates.items() if v is not None})
    row.config = current
    flag_modified(row, "config")
    await db.commit()
    return current
