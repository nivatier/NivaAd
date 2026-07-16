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
# video_ratio: the aspect ratio the reframe pipeline (services/reframe.py)
# treats as this platform's required format — moved here (2026-07-16)
# from a separate platform_ratios.py module specifically because that
# module's platform list (5 generic ids) didn't match this one (7 real
# integration ids, including the linkedin personal/company split and
# threads) — keeping ratio as a field on the SAME entries developers
# actually manage means adding a platform and setting its ratio happen
# in one place, and the two lists can never drift out of sync again.
DEFAULT_PLATFORMS = [
    {"id": "linkedin_personal", "label": "LinkedIn (Personal)", "client_id": "", "client_secret_encrypted": "", "scope": "openid profile w_member_social", "redirect_uri": "", "enabled": False, "video_ratio": "1.91:1"},
    {"id": "linkedin_company", "label": "LinkedIn (Company Page)", "client_id": "", "client_secret_encrypted": "", "scope": "openid profile w_organization_social", "redirect_uri": "", "enabled": False, "video_ratio": "1.91:1"},
    {"id": "instagram", "label": "Instagram", "client_id": "", "client_secret_encrypted": "", "scope": "", "redirect_uri": "", "enabled": False, "video_ratio": "1:1"},
    {"id": "facebook", "label": "Facebook", "client_id": "", "client_secret_encrypted": "", "scope": "", "redirect_uri": "", "enabled": False, "video_ratio": "1.91:1"},
    {"id": "tiktok", "label": "TikTok", "client_id": "", "client_secret_encrypted": "", "scope": "", "redirect_uri": "", "enabled": False, "video_ratio": "9:16"},
    {"id": "x", "label": "X (Twitter)", "client_id": "", "client_secret_encrypted": "", "scope": "", "redirect_uri": "", "enabled": False, "video_ratio": "16:9"},
    {"id": "threads", "label": "Threads", "client_id": "", "client_secret_encrypted": "", "scope": "", "redirect_uri": "", "enabled": False, "video_ratio": "1:1"},
]


async def get_platform_integrations(db: AsyncSession) -> list[dict]:
    """Every configured platform integration, WITH the decrypted secret
    (developer-only access — never returned to the frontend as
    plaintext, see routers/developer.py which masks it before
    responding). Seeds from DEFAULT_PLATFORMS the first time (if
    nothing's been stored yet).

    Backfills video_ratio for any entry that predates this field
    (added 2026-07-16) — an already-stored integration from before this
    change simply won't have the key at all, same class of gap as the
    earlier "linkedin" -> "linkedin_personal" rename that needed the
    same kind of fix. Matches by id against DEFAULT_PLATFORMS; a
    platform the developer added themselves (not one of the 7 defaults)
    falls back to "1:1" as a safe, common default rather than being
    left with no ratio at all."""
    row = await db.get(ModelConfig, 1)
    stored = row.config if row and row.config else {}
    raw = stored.get("platforms")
    platforms = raw if isinstance(raw, list) and raw else list(DEFAULT_PLATFORMS)
    defaults_by_id = {p["id"]: p["video_ratio"] for p in DEFAULT_PLATFORMS}
    for p in platforms:
        if "video_ratio" not in p:
            p["video_ratio"] = defaults_by_id.get(p["id"], "1:1")
    return platforms


def get_platform_integrations_sync(db) -> list[dict]:
    """SYNC equivalent — for use inside Celery tasks (tasks.py), which
    run on a sync SQLAlchemy session/engine, same reasoning as
    credits.get_available_models_sync. Same backfill logic as the async
    version above."""
    row = db.get(ModelConfig, 1)
    stored = row.config if row and row.config else {}
    raw = stored.get("platforms")
    platforms = raw if isinstance(raw, list) and raw else list(DEFAULT_PLATFORMS)
    defaults_by_id = {p["id"]: p["video_ratio"] for p in DEFAULT_PLATFORMS}
    for p in platforms:
        if "video_ratio" not in p:
            p["video_ratio"] = defaults_by_id.get(p["id"], "1:1")
    return platforms


# Ad-targeting platform ids (used in ad.platforms, e.g. Create Ad's
# platform picker) are a SEPARATE, simpler set than the OAuth
# integrations list above — "linkedin" as one id, not split into
# personal/company the way a real connection has to be. This maps the
# ad-targeting id to whichever integration entry should be treated as
# canonical for its ratio — personal and company page would want the
# same native format regardless of which one is actually connected, so
# "linkedin_personal" is used as that source rather than needing a
# third, separate ratio setting just for ad-targeting purposes.
_AD_TARGETING_TO_INTEGRATION_ID = {
    "instagram": "instagram", "facebook": "facebook", "linkedin": "linkedin_personal",
    "x": "x", "tiktok": "tiktok",
}


def _build_ratio_map(integrations: list[dict]) -> dict:
    by_id = {p["id"]: p.get("video_ratio", "1:1") for p in integrations}
    return {ad_id: by_id.get(integration_id, "1:1") for ad_id, integration_id in _AD_TARGETING_TO_INTEGRATION_ID.items() if integration_id in by_id}


async def get_ad_targeting_ratios(db: AsyncSession) -> dict:
    return _build_ratio_map(await get_platform_integrations(db))


def get_ad_targeting_ratios_sync(db) -> dict:
    return _build_ratio_map(get_platform_integrations_sync(db))


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
