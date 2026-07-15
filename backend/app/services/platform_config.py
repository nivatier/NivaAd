"""Developer-managed platform posting integrations (LinkedIn, and
whichever others get real integration code later) — client credentials
live here, in the database, encrypted, NOT in .env. This is what lets
the developer add/enable/disable platforms and rotate credentials
without a server restart, and is the reason company admins can be
shown "which platforms exist" without ever touching the actual
secrets.

Reuses the existing ModelConfig table (id=1) the model list already
lives in, under a new top-level "platforms" key — avoids a migration
for a new table, same reasoning as how the model list itself was
built."""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models import ModelConfig
from app.services.token_crypto import decrypt_token, encrypt_token

# Seed values only — used to populate the list the FIRST time it's ever
# read, so Developer > Platforms shows every discussed platform right
# away instead of an empty list. From that point on, the stored list is
# authoritative and this is never consulted again (same seed-then-edit
# pattern as the model list). client_id/client_secret_encrypted are
# deliberately blank — these are placeholders to configure, not real
# credentials — and every entry starts DISABLED so nothing shows up as
# connectable to a company until the developer has actually entered
# real credentials and turned it on.
#
# LinkedIn is split into two separate entries (not one, per the earlier
# design discussion): Personal profile posting (w_member_social, self-
# serve, no approval) and Company Page posting (w_organization_social,
# requires LinkedIn's Community Management API approval). Only
# "linkedin_personal" has real integration code behind it so far (see
# services/linkedin.py) — "linkedin_company" needs the Organization API
# work (listing which pages a user manages, a page-picker step, posting
# with the organization URN) discussed but not yet built.
DEFAULT_PLATFORMS = [
    {"id": "linkedin_personal", "label": "LinkedIn (Personal)", "client_id": "", "client_secret_encrypted": "", "scope": "openid profile w_member_social", "redirect_uri": "", "enabled": False},
    {"id": "linkedin_company", "label": "LinkedIn (Company Page)", "client_id": "", "client_secret_encrypted": "", "scope": "openid profile w_organization_social", "redirect_uri": "", "enabled": False},
    {"id": "instagram", "label": "Instagram", "client_id": "", "client_secret_encrypted": "", "scope": "", "redirect_uri": "", "enabled": False},
    {"id": "facebook", "label": "Facebook", "client_id": "", "client_secret_encrypted": "", "scope": "", "redirect_uri": "", "enabled": False},
    {"id": "tiktok", "label": "TikTok", "client_id": "", "client_secret_encrypted": "", "scope": "", "redirect_uri": "", "enabled": False},
    {"id": "x", "label": "X (Twitter)", "client_id": "", "client_secret_encrypted": "", "scope": "", "redirect_uri": "", "enabled": False},
    {"id": "threads", "label": "Threads", "client_id": "", "client_secret_encrypted": "", "scope": "", "redirect_uri": "", "enabled": False},
]


async def get_platform_integrations(db: AsyncSession) -> list[dict]:
    """Every configured platform integration, WITH the decrypted secret
    (developer-only access — never returned to the frontend as
    plaintext, see routers/developer.py which masks it before
    responding). Seeds from DEFAULT_PLATFORMS the first time (if
    nothing's been stored yet)."""
    row = await db.get(ModelConfig, 1)
    stored = row.config if row and row.config else {}
    raw = stored.get("platforms")
    return raw if isinstance(raw, list) and raw else list(DEFAULT_PLATFORMS)


async def save_platform_integrations(db: AsyncSession, platforms: list[dict]) -> None:
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    config["platforms"] = platforms
    row.config = config
    flag_modified(row, "config")
    await db.commit()


async def get_platform_credentials(db: AsyncSession, platform_id: str) -> dict | None:
    """What connections.py actually needs to run an OAuth flow — decrypted
    client_secret included, since this is called server-side only,
    never exposed in an API response."""
    for p in await get_platform_integrations(db):
        if p["id"] == platform_id:
            if not p.get("enabled", True):
                return None
            return {
                "client_id": p.get("client_id", ""),
                "client_secret": decrypt_token(p["client_secret_encrypted"]) if p.get("client_secret_encrypted") else "",
                "scope": p.get("scope", ""),
                "redirect_uri": p.get("redirect_uri", ""),
            }
    return None
