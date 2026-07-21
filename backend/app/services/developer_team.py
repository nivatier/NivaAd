"""Platform-operator team accounts (Developer > Team) — lets the owner
(the single DEVELOPER_EMAIL/DEVELOPER_PASSWORD login in .env) invite
additional developer users and grant each one a configurable subset of
sections, mirroring the Admin > Profiles pattern already used for
per-company editor/poster capabilities (see services/capabilities.py).

The owner is never a row in developer_team_users — it authenticates
purely against .env (see routers/developer.py's /login) and always has
every permission implicitly, exactly like how Admin's "admin" role is
never a configurable capabilities entry either. Team members log in
with a real email+password checked against this table.

Permissions gate a whole section (page access AND everything within
it) rather than individual actions within a section — a coarser grain
than the per-company system, deliberately: this is a small internal
team tool, not a multi-tenant product, so section-level is enough
without needing 30+ granular toggles across every developer endpoint.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DeveloperTeamUser
from app.security import hash_password, verify_password

PERMISSION_KEYS = ["companies", "models", "pricing", "themes", "assistant", "guardrails", "platforms", "settings", "team"]

PERMISSION_LABELS = {
    "companies": "Companies (view every company, credits, subscriptions)",
    "models": "Models (text/image/video model catalog & pricing tiers)",
    "pricing": "Pricing (markup multiplier, Stripe price setup)",
    "themes": "Themes (Text/Image/Video Theme Reference, text styles)",
    "assistant": "Assistant (mascot settings & hint messages)",
    "guardrails": "Guardrails & moderation (flagged content, blocked phrases)",
    "platforms": "Platform integrations (OAuth client IDs/secrets)",
    "settings": "Settings (retention, video ratios, team limits, theme AI models)",
    "team": "Team (invite/manage other developer team members — sensitive: grants the ability to grant itself and everything else)",
}

# Overview is intentionally always visible to every team member (read-only
# platform snapshot) — not worth gating, and useful context for anyone who's
# been given access to anything at all.
DEFAULT_PERMISSIONS = {k: False for k in PERMISSION_KEYS}


def _public(row: DeveloperTeamUser) -> dict:
    return {
        "id": str(row.id), "email": row.email, "full_name": row.full_name,
        "permissions": {**DEFAULT_PERMISSIONS, **(row.permissions or {})},
        "status": row.status, "created_at": row.created_at,
    }


async def list_team_users(db: AsyncSession) -> list[dict]:
    rows = (await db.scalars(select(DeveloperTeamUser).order_by(DeveloperTeamUser.created_at.asc()))).all()
    return [_public(r) for r in rows]


async def create_team_user(db: AsyncSession, email: str, full_name: str, password: str, permissions: dict) -> dict:
    email = email.strip().lower()
    existing = await db.scalar(select(DeveloperTeamUser).where(DeveloperTeamUser.email == email))
    if existing:
        raise ValueError(f'A developer team member with email "{email}" already exists.')
    row = DeveloperTeamUser(
        email=email, full_name=full_name.strip(), password_hash=hash_password(password),
        permissions={**DEFAULT_PERMISSIONS, **permissions}, status="active",
    )
    db.add(row)
    await db.commit()
    return _public(row)


async def update_team_user(
    db: AsyncSession, user_id: uuid.UUID, full_name: str | None = None,
    permissions: dict | None = None, status: str | None = None, password: str | None = None,
) -> dict:
    row = await db.get(DeveloperTeamUser, user_id)
    if row is None:
        raise ValueError("No such developer team member.")
    if full_name is not None:
        row.full_name = full_name.strip()
    if permissions is not None:
        row.permissions = {**DEFAULT_PERMISSIONS, **(row.permissions or {}), **permissions}
    if status is not None:
        if status not in ("active", "disabled"):
            raise ValueError('status must be "active" or "disabled".')
        row.status = status
    if password:
        row.password_hash = hash_password(password)
    await db.commit()
    return _public(row)


async def delete_team_user(db: AsyncSession, user_id: uuid.UUID) -> None:
    row = await db.get(DeveloperTeamUser, user_id)
    if row is None:
        raise ValueError("No such developer team member.")
    await db.delete(row)
    await db.commit()


async def authenticate_team_user(db: AsyncSession, email: str, password: str) -> DeveloperTeamUser | None:
    row = await db.scalar(select(DeveloperTeamUser).where(DeveloperTeamUser.email == email.strip().lower()))
    if row is None or row.status != "active":
        return None
    if not verify_password(password, row.password_hash):
        return None
    return row
