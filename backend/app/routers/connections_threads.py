"""Threads OAuth connection endpoints.

Threads has its own separate OAuth system via graph.threads.net,
completely independent from the Facebook OAuth flow. It uses the
Threads App ID and Threads App Secret (shown in Meta App Settings
-> Basic as 'Threads app ID' and 'Threads app secret').

Flow:
  1. GET /connections/threads/connect
       -> returns Threads authorize_url
  2. GET /connections/threads/callback
       -> exchange code -> short-lived token -> long-lived token (60 days)
       -> fetch Threads profile (id, username)
       -> save encrypted PlatformConnection for 'threads'
       -> redirect to /app/connections?connected=threads

No page picker needed — Threads connects directly to the
authorizing user's own Threads profile.

Credentials needed in Developer -> Platforms -> threads:
  - Client ID:     Threads App ID  (e.g. 1252481470285817)
  - Client Secret: Threads App Secret
  - Redirect URI:  https://nivaad-production.up.railway.app/connections/threads/callback
  - Scope:         threads_basic,threads_content_publish
"""
import json
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
from app.services import meta as meta_svc
from app.services import platform_config
from app.services.token_crypto import encrypt_token

router = APIRouter(prefix="/connections", tags=["connections"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _sign_state(company_id: str) -> str:
    payload = {
        "company_id": company_id,
        "flow": "threads",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _verify_state(state: str) -> str:
    try:
        payload = jwt.decode(
            state, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
        )
    except jwt.PyJWTError:
        raise HTTPException(
            400, "Invalid or expired connection request — please try connecting again."
        )
    if payload.get("flow") != "threads":
        raise HTTPException(400, "State mismatch — wrong OAuth flow.")
    return payload["company_id"]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/threads/connect")
async def threads_connect(
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Step 1 — kick off Threads OAuth flow.
    Returns the Threads authorize URL for the frontend to navigate to.
    Requires a paid plan.
    """
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
            "Threads connection requires a paid plan. "
            "Upgrade to Starter or Pro to connect all platforms.",
        )

    creds = await platform_config.get_platform_credentials(db, "threads")
    if not creds or not creds["client_id"]:
        raise HTTPException(
            503,
            "Threads isn't configured yet — ask the platform developer to add "
            "credentials in Developer > Platforms.",
        )

    redirect_uri = (
        creds["redirect_uri"]
        or f"{settings.BACKEND_URL}/connections/threads/callback"
    )
    state = _sign_state(str(user.company_id))

    return {
        "authorize_url": meta_svc.get_threads_authorize_url(
            creds["client_id"], redirect_uri, state
        )
    }


@router.get("/threads/callback")
async def threads_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Step 2 — Threads redirects here after user consent.
    Exchange code -> long-lived token -> save PlatformConnection.
    """
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
        creds = await platform_config.get_platform_credentials(db, "threads")
        if not creds:
            raise RuntimeError("Threads is no longer configured on this platform.")

        redirect_uri = (
            creds["redirect_uri"]
            or f"{settings.BACKEND_URL}/connections/threads/callback"
        )

        # Exchange code -> short-lived token
        token_data = meta_svc.exchange_threads_code_for_token(
            code, creds["client_id"], creds["client_secret"], redirect_uri
        )
        short_token = token_data.get("access_token")
        if not short_token:
            raise RuntimeError(f"Threads token exchange returned no access_token: {token_data}")

        # Exchange short-lived -> long-lived (60 days)
        long_token_data = meta_svc.exchange_threads_for_long_lived_token(
            short_token, creds["client_secret"]
        )
        long_token = long_token_data.get("access_token", short_token)

        # Fetch profile to validate and store username
        profile = meta_svc.get_threads_user_profile(long_token)
        threads_user_id = profile.get("id", "")
        username = profile.get("username", "")

        payload = json.dumps({
            "user_token": long_token,
            "threads_user_id": threads_user_id,
            "username": username,
        })
        encrypted = encrypt_token(payload)

    except Exception as exc:  # noqa: BLE001
        return RedirectResponse(
            f"{settings.FRONTEND_URL}/app/connections?connection_error={str(exc)[:200]}"
        )

    # Upsert PlatformConnection
    existing = await db.scalar(
        select(PlatformConnection).where(
            PlatformConnection.company_id == uuid.UUID(company_id),
            PlatformConnection.platform == "threads",
        )
    )
    if existing:
        existing.encrypted_token = encrypted
        existing.status = "connected"
        existing.connected_at = datetime.utcnow()
    else:
        db.add(PlatformConnection(
            company_id=uuid.UUID(company_id),
            platform="threads",
            encrypted_token=encrypted,
            status="connected",
        ))
    await db.commit()

    return RedirectResponse(
        f"{settings.FRONTEND_URL}/app/connections?connected=threads"
    )
