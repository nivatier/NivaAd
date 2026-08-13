"""LinkedIn Company Page OAuth connection and page-picker endpoints.

Kept separate from connections.py (which owns the generic list/disconnect
endpoints and the linkedin_personal flow) so each platform can grow
independently without one file becoming unmanageable.

Flow:
  1. GET /connections/linkedin_company/connect
       → returns authorize_url using the linkedin_company app credentials
  2. GET /connections/linkedin_company/callback
       → LinkedIn redirects here with code; we exchange it for a token,
         store it temporarily in Redis (60 min TTL), then redirect the
         browser to /app/connections?pick_pages=1 so the frontend knows
         to open the page-picker modal.
  3. GET /connections/linkedin_company/pages
       → frontend calls this (authenticated) to get the list of Company
         Pages the connected token can admin. Reads the temp token from
         Redis — no page has been saved yet at this point.
  4. POST /connections/linkedin_company/select
       → frontend posts the chosen org_urn; we move the token from Redis
         into PlatformConnection (encrypted) as a real saved connection.

Redis temp-token key: linkedin_company_temp:{company_id}
TTL: 3600 seconds (1 hour) — plenty of time for the user to pick a page.
"""
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
from app.services import linkedin as li_svc
from app.services import platform_config
from app.services.token_crypto import encrypt_token

router = APIRouter(prefix="/connections", tags=["connections"])

_TEMP_TOKEN_TTL = 3600  # seconds


# ── helpers ───────────────────────────────────────────────────────────────────

def _sign_state(company_id: str) -> str:
    payload = {
        "company_id": company_id,
        "flow": "linkedin_company",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _verify_state(state: str) -> str:
    try:
        payload = jwt.decode(state, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(400, "Invalid or expired connection request — please try connecting again.")
    if payload.get("flow") != "linkedin_company":
        raise HTTPException(400, "State mismatch — wrong OAuth flow.")
    return payload["company_id"]


def _redis():
    import redis as redis_lib
    return redis_lib.from_url(settings.REDIS_URL, decode_responses=True)


def _store_temp_token(company_id: str, access_token: str) -> None:
    """Save the raw access token in Redis for up to 1 hour while the
    user picks which Company Page to connect. Encrypted at rest in
    PlatformConnection once a page is selected."""
    r = _redis()
    r.set(f"linkedin_company_temp:{company_id}", access_token, ex=_TEMP_TOKEN_TTL)


def _read_temp_token(company_id: str) -> str | None:
    try:
        r = _redis()
        return r.get(f"linkedin_company_temp:{company_id}")
    except Exception:
        return None


def _delete_temp_token(company_id: str) -> None:
    try:
        _redis().delete(f"linkedin_company_temp:{company_id}")
    except Exception:
        pass


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/linkedin_company/connect")
async def linkedin_company_connect(
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Step 1 — kick off the OAuth flow for LinkedIn Company Page posting.
    Uses a SEPARATE LinkedIn app (different client_id/secret from
    linkedin_personal) configured under Developer > Platforms with id
    'linkedin_company'. Returns the authorize URL for the frontend to
    navigate to."""
    creds = await platform_config.get_platform_credentials(db, "linkedin_company")
    if not creds or not creds["client_id"]:
        raise HTTPException(
            503,
            "LinkedIn Company Page isn't configured yet — ask the platform developer "
            "to add the linkedin_company credentials in Developer > Platforms.",
        )
    redirect_uri = creds["redirect_uri"] or f"{settings.BACKEND_URL}/connections/linkedin_company/callback"
    state = _sign_state(str(user.company_id))
    return {
        "authorize_url": li_svc.get_authorize_url(
            creds["client_id"], redirect_uri, creds["scope"], state
        )
    }


@router.get("/linkedin_company/callback")
async def linkedin_company_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Step 2 — LinkedIn redirects here after the user grants consent.
    We exchange the code for a token, stash it in Redis temporarily,
    then bounce the browser back to /app/connections?pick_pages=1 so
    the frontend knows to open the Company Page picker modal."""
    if error:
        msg = error_description or error
        return RedirectResponse(f"{settings.FRONTEND_URL}/app/connections?connection_error={msg}")
    if not code or not state:
        return RedirectResponse(
            f"{settings.FRONTEND_URL}/app/connections?connection_error=Missing+code+or+state"
        )

    try:
        company_id = _verify_state(state)
        creds = await platform_config.get_platform_credentials(db, "linkedin_company")
        if not creds:
            raise RuntimeError("LinkedIn Company Page is no longer configured on this platform.")
        redirect_uri = (
            creds["redirect_uri"]
            or f"{settings.BACKEND_URL}/connections/linkedin_company/callback"
        )
        token_data = li_svc.exchange_code_for_token(
            code, creds["client_id"], creds["client_secret"], redirect_uri
        )
        access_token = token_data["access_token"]
        # Validate token works before storing
        li_svc.get_person_urn(access_token)
        _store_temp_token(company_id, access_token)
    except Exception as exc:  # noqa: BLE001
        return RedirectResponse(
            f"{settings.FRONTEND_URL}/app/connections?connection_error={str(exc)[:200]}"
        )

    # Tell the frontend to open the page picker
    return RedirectResponse(f"{settings.FRONTEND_URL}/app/connections?pick_pages=1")


@router.get("/linkedin_company/pages")
async def linkedin_company_pages(
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Step 3 — return the list of LinkedIn Company Pages the connected
    token can admin. Called by the frontend after the OAuth callback
    redirects back with ?pick_pages=1. Reads the temp token from Redis
    — the user hasn't saved a page yet at this point."""
    company_id = str(user.company_id)
    access_token = _read_temp_token(company_id)
    if not access_token:
        raise HTTPException(
            400,
            "No pending LinkedIn Company connection found — please start the connection again.",
        )

    try:
        pages = li_svc.get_organization_pages(access_token)
    except Exception as exc:
        raise HTTPException(502, f"Could not fetch your LinkedIn Pages: {exc}") from exc

    if not pages:
        raise HTTPException(
            404,
            "No LinkedIn Company Pages found for this account. "
            "Make sure you are an admin of at least one LinkedIn Page.",
        )
    return {"pages": pages}


class SelectPageIn(BaseModel):
    org_urn: str    # e.g. "urn:li:organization:12345678"
    page_name: str  # display name — stored for the UI to show


# ── Catch-all (must be last in this router, registered after all specific
#    platform routes so it never shadows them) ─────────────────────────────────

from sqlalchemy import select as _select  # noqa: E402
from app.models import Subscription  # noqa: E402


@router.get("/{platform}/connect")
async def connect_platform_gated(
    platform: str,
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Catch-all for any platform connect attempt that has no real
    integration yet. Free-tier users are blocked; paid users get a clear
    'not built yet' message. Kept here (after all specific routes) so it
    never accidentally shadows linkedin_personal or linkedin_company."""
    sub = await db.scalar(
        _select(Subscription)
        .where(Subscription.company_id == user.company_id)
        .order_by(Subscription.created_at.desc())
    )
    tier = sub.tier if sub else "free"
    if tier == "free":
        raise HTTPException(
            403,
            "Platform connections other than LinkedIn Personal require a paid plan. "
            "Upgrade to Starter or Pro to connect all platforms.",
        )
    raise HTTPException(404, f"No connection integration exists for platform '{platform}' yet.")


@router.post("/linkedin_company/select")
async def linkedin_company_select(
    body: SelectPageIn,
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Step 4 — user picked a page in the modal. Move the temp token
    from Redis into PlatformConnection (encrypted) and save the chosen
    org_urn so posting uses it as the author URN."""
    company_id = str(user.company_id)
    access_token = _read_temp_token(company_id)
    if not access_token:
        raise HTTPException(
            400,
            "Session expired — please reconnect LinkedIn Company Page.",
        )

    if not body.org_urn.startswith("urn:li:organization:"):
        raise HTTPException(400, "Invalid organization URN.")

    # Encrypt the token + store the chosen org_urn together as JSON
    import json
    payload = json.dumps({"access_token": access_token, "org_urn": body.org_urn, "page_name": body.page_name})
    encrypted = encrypt_token(payload)

    existing = await db.scalar(
        select(PlatformConnection).where(
            PlatformConnection.company_id == uuid.UUID(company_id),
            PlatformConnection.platform == "linkedin_company",
        )
    )
    if existing:
        existing.encrypted_token = encrypted
        existing.status = "connected"
        existing.connected_at = datetime.utcnow()
    else:
        db.add(PlatformConnection(
            company_id=uuid.UUID(company_id),
            platform="linkedin_company",
            encrypted_token=encrypted,
            status="connected",
        ))
    await db.commit()
    _delete_temp_token(company_id)

    return {"ok": True, "page_name": body.page_name, "org_urn": body.org_urn}
