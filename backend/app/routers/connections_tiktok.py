"""TikTok OAuth connection endpoints.

Kept separate from connections.py (generic list/disconnect) and
connections_linkedin.py so each platform grows independently.

Flow:
  1. GET /connections/tiktok/connect
       → returns authorize_url using tiktok platform credentials
  2. GET /connections/tiktok/callback
       → TikTok redirects here with code + state; we exchange for a
         token, save it encrypted in PlatformConnection, redirect back
         to /app/connections?connected=tiktok

No page/account picker needed — TikTok always connects to the
authorizing user's own account directly.

TikTok uses "Client Key" as their term but we store it as client_id
in platform_config for consistency with all other platforms.
"""
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import require_role
from app.models import PlatformConnection, User
from app.services import tiktok as tiktok_svc
from app.services import platform_config
from app.services.token_crypto import encrypt_token

router = APIRouter(prefix="/connections", tags=["connections"])


# ── helpers ───────────────────────────────────────────────────────────────────

def _sign_state(company_id: str) -> str:
    payload = {
        "company_id": company_id,
        "flow": "tiktok",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _verify_state(state: str) -> str:
    try:
        payload = jwt.decode(state, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(400, "Invalid or expired connection request — please try connecting again.")
    if payload.get("flow") != "tiktok":
        raise HTTPException(400, "State mismatch — wrong OAuth flow.")
    return payload["company_id"]


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/tiktok/connect")
async def tiktok_connect(
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Step 1 — kick off TikTok OAuth flow.
    Returns the TikTok authorize URL for the frontend to navigate to.
    Requires a paid plan (same gate as all non-LinkedIn platforms)."""
    from sqlalchemy import select as _sel
    from app.models import Subscription

    sub = await db.scalar(
        _sel(Subscription)
        .where(Subscription.company_id == user.company_id)
        .order_by(Subscription.created_at.desc())
    )
    tier = sub.tier if sub else "free"
    if tier == "free":
        raise HTTPException(
            403,
            "TikTok connection requires a paid plan. "
            "Upgrade to Starter or Pro to connect all platforms.",
        )

    creds = await platform_config.get_platform_credentials(db, "tiktok")
    if not creds or not creds["client_id"]:
        raise HTTPException(
            503,
            "TikTok isn't configured yet — ask the platform developer to add "
            "credentials in Developer > Platforms.",
        )

    redirect_uri = (
        creds["redirect_uri"]
        or f"{settings.BACKEND_URL}/connections/tiktok/callback"
    )
    state = _sign_state(str(user.company_id))

    return {
        "authorize_url": tiktok_svc.get_authorize_url(
            creds["client_id"], redirect_uri, creds["scope"], state
        )
    }


@router.get("/tiktok/callback")
async def tiktok_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    scopes: str | None = None,  # TikTok passes granted scopes here
    db: AsyncSession = Depends(get_db),
):
    """Step 2 — TikTok redirects the browser here after user consent.
    Exchange code → token, save encrypted, redirect back into the app."""
    if error:
        msg = error_description or error
        return RedirectResponse(
            f"{settings.FRONTEND_URL}/app/connections?connection_error={msg}"
        )
    if not code or not state:
        return RedirectResponse(
            f"{settings.FRONTEND_URL}/app/connections?connection_error=Missing+code+or+state"
        )

    try:
        company_id = _verify_state(state)
        creds = await platform_config.get_platform_credentials(db, "tiktok")
        if not creds:
            raise RuntimeError("TikTok is no longer configured on this platform.")

        redirect_uri = (
            creds["redirect_uri"]
            or f"{settings.BACKEND_URL}/connections/tiktok/callback"
        )
        token_data = tiktok_svc.exchange_code_for_token(
            code, creds["client_id"], creds["client_secret"], redirect_uri
        )
        access_token = token_data.get("access_token")
        if not access_token:
            raise RuntimeError(f"TikTok token exchange returned no access_token: {token_data}")

        # Validate token works + store open_id alongside it for logging
        user_info = tiktok_svc.get_user_info(access_token)
        open_id = user_info.get("open_id", "")

        import json
        payload = json.dumps({
            "access_token": access_token,
            "refresh_token": token_data.get("refresh_token", ""),
            "open_id": open_id,
            "display_name": user_info.get("display_name", ""),
        })
        encrypted = encrypt_token(payload)

    except Exception as exc:  # noqa: BLE001
        return RedirectResponse(
            f"{settings.FRONTEND_URL}/app/connections?connection_error={str(exc)[:200]}"
        )

    existing = await db.scalar(
        select(PlatformConnection).where(
            PlatformConnection.company_id == uuid.UUID(company_id),
            PlatformConnection.platform == "tiktok",
        )
    )
    if existing:
        existing.encrypted_token = encrypted
        existing.status = "connected"
        existing.connected_at = datetime.utcnow()
    else:
        db.add(PlatformConnection(
            company_id=uuid.UUID(company_id),
            platform="tiktok",
            encrypted_token=encrypted,
            status="connected",
        ))
    await db.commit()

    return RedirectResponse(
        f"{settings.FRONTEND_URL}/app/connections?connected=tiktok"
    )
