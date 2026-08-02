"""Configurable per-role capabilities — both ACTIONS (can this role do X)
and PAGE ACCESS (can this role even see/open a given page). Admin always
has every capability implicitly — it's never stored or configurable,
it's just always True. Editor and Poster start with sensible defaults
and an admin can customize them per company from Admin > Profiles.

Admin the PAGE is deliberately NOT a capability here — it's always
admin-only, hardcoded, never configurable — since Admin contains the
controls to grant every other capability (including page access), so
exposing it to editor/poster would be a privilege-escalation path."""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RoleCapability, Subscription, User

# Capabilities gated to Pro tier only — Starter and Free users never
# see these regardless of their role. Admin users on those tiers are
# also blocked — the tier is a product-level limit, not a role limit.
PRO_ONLY_CAPS = {"view_analytics"}

# Capabilities gated to paid plans (Starter + Pro) only.
PAID_ONLY_CAPS: set[str] = set()  # currently none, reserved for future use

ACTION_KEYS = ["create_ads", "manage_campaigns", "manage_products", "manage_brand_kit", "post_content"]
PAGE_KEYS = ["view_my_ads", "view_campaigns", "view_brand_kit", "view_analytics", "view_settings"]  # view_schedule REMOVED 2026-07-12 — Schedule merged into My Ads, so view_my_ads is what actually gates this now
CAPABILITY_KEYS = ACTION_KEYS + PAGE_KEYS

ACTION_LABELS = {
    "create_ads": "Create ads (the Create Ad wizard)",
    "manage_campaigns": "Create & manage campaigns",
    "manage_products": "Manage the product library",
    "manage_brand_kit": "Edit brand kit (logo, colors, tagline)",
    "post_content": "Post or schedule ads to platforms",
}
PAGE_LABELS = {
    "view_my_ads": "My Ads",
    "view_campaigns": "Campaigns",
    "view_brand_kit": "Brand Kit",
    "view_analytics": "Analytics",
    "view_settings": "Settings",
}

# Create Ad and Products are ALWAYS visible to any active user (not a
# toggle) — Create Ad because create_ads already gates whether they can
# actually DO anything there, and Products because the Create Ad wizard's
# own product picker depends on reading the product list regardless of
# whether the standalone Products page is something you want to show —
# gating product-read here would silently break Create Ad for anyone.

DEFAULT_CAPABILITIES = {
    "editor": {
        "create_ads": True, "manage_campaigns": True, "manage_products": True,
        "manage_brand_kit": False, "post_content": False,
        "view_my_ads": True, "view_campaigns": True,
        "view_brand_kit": False, "view_analytics": True, "view_settings": False,
    },
    "poster": {
        "create_ads": False, "manage_campaigns": False, "manage_products": False,
        "manage_brand_kit": False, "post_content": True,
        "view_my_ads": True, "view_campaigns": False,
        "view_brand_kit": False, "view_analytics": False, "view_settings": False,
    },
}


async def get_capabilities(db: AsyncSession, company_id: uuid.UUID) -> dict:
    """Returns the FULL resolved {"editor": {...}, "poster": {...}} config
    for a company — merged with defaults so a newly-added capability key
    always has a value, even for companies that customized this before
    that key existed."""
    row = await db.scalar(select(RoleCapability).where(RoleCapability.company_id == company_id))
    stored = row.config if row and row.config else {}
    return {
        role: {**DEFAULT_CAPABILITIES[role], **(stored.get(role) or {})}
        for role in ("editor", "poster")
    }


async def capabilities_for_user(db: AsyncSession, user: User) -> dict:
    """Resolved capabilities for THIS specific user.

    Two layers of gating:
    1. Role — admin gets everything True; editor/poster follow their
       company's configurable defaults.
    2. Tier — some capabilities are gated at the product level regardless
       of role. An admin on the Starter plan still can't see Analytics
       (Pro-only). Tier is checked against the company's Subscription row.
    """
    # Resolve role-level caps first
    if user.role == "admin":
        caps = {k: True for k in CAPABILITY_KEYS}
    else:
        all_caps = await get_capabilities(db, user.company_id)
        caps = all_caps.get(user.role, {k: False for k in CAPABILITY_KEYS})

    # Apply tier-level gates — look up subscription once
    sub = await db.scalar(
        select(Subscription)
        .where(Subscription.company_id == user.company_id)
        .order_by(Subscription.created_at.desc())
    )
    tier = sub.tier if sub else "free"

    # Pro-only caps — disable for free and starter
    if tier not in ("pro",):
        for cap in PRO_ONLY_CAPS:
            caps[cap] = False

    # Paid-only caps — disable for free
    if tier == "free":
        for cap in PAID_ONLY_CAPS:
            caps[cap] = False

    return caps


async def user_has_capability(db: AsyncSession, user: User, capability: str) -> bool:
    if user.role == "admin":
        return True
    caps = await capabilities_for_user(db, user)
    return caps.get(capability, False)
