"""Meta (Facebook / Instagram / Threads) OAuth connection endpoints.

One OAuth flow connects all three platforms simultaneously. The flow
mirrors connections_linkedin.py — a temp token is stored in Redis
after the callback, then the user picks which Facebook Page to use,
and the final encrypted token bundle is saved to PlatformConnection
for facebook, instagram, and threads separately.

Flow:
  1. GET /connections/facebook/connect
       → returns Meta authorize_url
  2. GET /connections/facebook/callback
       → exchange code → long-lived user token
       → stash in Redis, redirect to /app/connections?pick_facebook_pages=1
  3. GET /connections/facebook/pages
       → return list of Pages + linked IG account + Threads profile
  4. POST /connections/facebook/select
       → save PlatformConnection rows for facebook, instagram (if linked),
         and threads (if linked)
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
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

_TEMP_TOKEN_TTL = 3600  # 1 hour — time for the user to pick their page


# ── Helpers ───────────────────────────────────────────────────────────────────

def _sign_state(company_id: str) -> str:
    payload = {
        "company_id": company_id,
        "flow": "facebook",
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
    if payload.get("flow") != "facebook":
        raise HTTPException(400, "State mismatch — wrong OAuth flow.")
    return payload["company_id"]


def _redis():
    import redis as redis_lib
    return redis_lib.from_url(settings.REDIS_URL, decode_responses=True)


def _store_temp_token(company_id: str, user_token: str) -> None:
    _redis().set(f"facebook_temp:{company_id}", user_token, ex=_TEMP_TOKEN_TTL)


def _read_temp_token(company_id: str) -> str | None:
    try:
        return _redis().get(f"facebook_temp:{company_id}")
    except Exception:
        return None


def _delete_temp_token(company_id: str) -> None:
    try:
        _redis().delete(f"facebook_temp:{company_id}")
    except Exception:
        pass


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/facebook/connect")
async def facebook_connect(
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Step 1 — start Meta OAuth flow covering Facebook, Instagram, Threads.
    Requires a paid plan (same gate as TikTok and all non-LinkedIn platforms).
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
            "Facebook connection requires a paid plan. "
            "Upgrade to Starter or Pro to connect all platforms.",
        )

    creds = await platform_config.get_platform_credentials(db, "facebook")
    if not creds or not creds["client_id"]:
        raise HTTPException(
            503,
            "Facebook isn't configured yet — ask the platform developer to add "
            "credentials in Developer > Platforms.",
        )

    redirect_uri = (
        creds["redirect_uri"]
        or f"{settings.BACKEND_URL}/connections/facebook/callback"
    )
    state = _sign_state(str(user.company_id))

    return {
        "authorize_url": meta_svc.get_authorize_url(
            creds["client_id"], redirect_uri, creds["scope"], state
        )
    }


@router.get("/facebook/callback")
async def facebook_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Step 2 — Meta redirects here after user consent.
    Exchange code → long-lived user token → stash in Redis →
    redirect to the page picker.
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
        creds = await platform_config.get_platform_credentials(db, "facebook")
        if not creds:
            raise RuntimeError("Facebook is no longer configured on this platform.")

        redirect_uri = (
            creds["redirect_uri"]
            or f"{settings.BACKEND_URL}/connections/facebook/callback"
        )

        # Exchange code → short-lived token → long-lived token (60 days)
        token_data = meta_svc.exchange_code_for_token(
            code, creds["client_id"], creds["client_secret"], redirect_uri
        )
        short_token = token_data["access_token"]
        long_token = meta_svc.exchange_for_long_lived_token(
            short_token, creds["client_id"], creds["client_secret"]
        )

        # Validate the token works
        meta_svc.get_user_id(long_token)
        _store_temp_token(company_id, long_token)

    except Exception as exc:  # noqa: BLE001
        return RedirectResponse(
            f"{settings.FRONTEND_URL}/app/connections?connection_error={str(exc)[:200]}"
        )

    return RedirectResponse(
        f"{settings.FRONTEND_URL}/app/connections?pick_facebook_pages=1"
    )


@router.get("/facebook/pages")
async def facebook_pages(
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Step 3 — return Pages + linked IG accounts + Threads profile."""
    company_id = str(user.company_id)
    user_token = _read_temp_token(company_id)
    if not user_token:
        raise HTTPException(
            400,
            "No pending Facebook connection found — please start the connection again.",
        )

    try:
        pages = meta_svc.get_managed_pages(user_token)
    except Exception as exc:
        raise HTTPException(502, f"Could not fetch your Facebook Pages: {exc}") from exc

    if not pages:
        raise HTTPException(
            404,
            "No Facebook Pages found for this account. "
            "Make sure you are an admin of at least one Facebook Page.",
        )

    # Enrich each page with its linked Instagram Business account (if any)
    for page in pages:
        try:
            page["instagram"] = meta_svc.get_instagram_account(
                page["page_id"], page["access_token"]
            )
        except Exception:
            page["instagram"] = None

    # Check for Threads profile linked to the user token
    threads_profile = None
    try:
        threads_profile = meta_svc.get_threads_profile(user_token)
    except Exception:
        pass

    return {"pages": pages, "threads": threads_profile}


class SelectMetaPageIn(BaseModel):
    page_id: str
    page_name: str
    page_token: str                      # page-scoped, never-expiring token
    ig_user_id: str | None = None
    ig_username: str | None = None
    threads_user_id: str | None = None
    threads_username: str | None = None
    connect_instagram: bool = True
    connect_threads: bool = True


@router.post("/facebook/select")
async def facebook_select(
    body: SelectMetaPageIn,
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Step 4 — user picked their page. Save PlatformConnection rows for
    facebook (always), instagram (if linked and opted in),
    threads (if linked and opted in).
    """
    company_id = str(user.company_id)
    user_token = _read_temp_token(company_id)
    if not user_token:
        raise HTTPException(400, "Session expired — please reconnect Facebook.")

    company_uuid = uuid.UUID(company_id)
    now = datetime.utcnow()
    connected_platforms = []

    # ── Facebook ──────────────────────────────────────────────────────
    fb_payload = {
        "page_token": body.page_token,
        "page_id": body.page_id,
        "page_name": body.page_name,
    }
    await _upsert_connection(
        db, company_uuid, "facebook", encrypt_token(json.dumps(fb_payload)), now
    )
    connected_platforms.append("facebook")

    # ── Instagram ─────────────────────────────────────────────────────
    if body.connect_instagram and body.ig_user_id:
        ig_payload = {
            "page_token": body.page_token,  # page token also grants IG access
            "ig_user_id": body.ig_user_id,
            "username": body.ig_username or "",
            "page_id": body.page_id,
        }
        await _upsert_connection(
            db, company_uuid, "instagram", encrypt_token(json.dumps(ig_payload)), now
        )
        connected_platforms.append("instagram")

    # ── Threads ───────────────────────────────────────────────────────
    if body.connect_threads and body.threads_user_id:
        th_payload = {
            "user_token": user_token,
            "threads_user_id": body.threads_user_id,
            "username": body.threads_username or "",
        }
        await _upsert_connection(
            db, company_uuid, "threads", encrypt_token(json.dumps(th_payload)), now
        )
        connected_platforms.append("threads")

    await db.commit()
    _delete_temp_token(company_id)

    return {
        "ok": True,
        "connected": connected_platforms,
        "page_name": body.page_name,
    }


# ── Internal helper ───────────────────────────────────────────────────────────

async def _upsert_connection(
    db: AsyncSession,
    company_id: uuid.UUID,
    platform: str,
    encrypted_token: str,
    now: datetime,
) -> None:
    """Insert or update a PlatformConnection row."""
    existing = await db.scalar(
        select(PlatformConnection).where(
            PlatformConnection.company_id == company_id,
            PlatformConnection.platform == platform,
        )
    )
    if existing:
        existing.encrypted_token = encrypted_token
        existing.status = "connected"
        existing.connected_at = now
    else:
        db.add(PlatformConnection(
            company_id=company_id,
            platform=platform,
            encrypted_token=encrypted_token,
            status="connected",
        ))
