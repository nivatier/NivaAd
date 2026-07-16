"""Real platform OAuth connections — starting with LinkedIn (see
services/linkedin.py for the API details and the personal-vs-company
scope caveat). Client credentials are developer-managed in the
database (services/platform_config.py), never in .env and never
exposed to a company admin — connecting only ever redirects through
this backend, which is the one place that ever touches the real
client_secret.

Admin-only throughout (require_role("admin"), not a capability check)
— connecting a company's own social account is a high-trust action
deliberately kept out of reach of editor/poster roles."""
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_role
from app.models import BrandKit, PlatformConnection, User
from app.schemas import CompanyPlatformOut, PlatformConnectionOut, VideoRatiosOut
from app.services import linkedin, platform_config
from app.services import video_ratios as video_ratios_svc
from app.services.token_crypto import decrypt_token, encrypt_token

router = APIRouter(prefix="/connections", tags=["connections"])

BACKEND_URL = "http://localhost:8000"  # matches this project's existing localhost-only dev setup (see FRONTEND_URL in config.py for the same pattern)


def _sign_state(company_id: str) -> str:
    """Short-lived signed token carrying the company_id through
    LinkedIn's redirect round-trip — avoids needing a separate
    server-side OAuth-state table just for CSRF protection; the JWT
    signature already proves it wasn't tampered with, and the 10-minute
    expiry keeps a leaked/replayed state URL from being useful for
    long."""
    payload = {"company_id": company_id, "exp": datetime.now(timezone.utc) + timedelta(minutes=10)}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _verify_state(state: str) -> str:
    try:
        payload = jwt.decode(state, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(400, "Invalid or expired connection request — please try connecting again.")
    return payload["company_id"]


@router.get("/available", response_model=list[CompanyPlatformOut])
async def list_available_platforms(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """What a company admin sees as OPTIONS to connect — only platforms
    the developer has actually configured AND enabled. Never includes
    client_id/secret."""
    platforms = await platform_config.get_platform_integrations(db)
    kit = await db.scalar(select(BrandKit).where(BrandKit.company_id == user.company_id))
    overrides = kit.platform_ratio_overrides if kit else {}
    return [
        CompanyPlatformOut(
            id=p["id"], label=p["label"],
            built=p["id"] in ("linkedin_personal",),  # FIXED — was still checking the old pre-rename "linkedin" id, meaning this always showed "Coming soon" for the one platform that actually has real integration code
            video_ratio=overrides.get(p["id"], p.get("video_ratio", "1:1")),  # company's own override wins over the developer default, same precedence as the reframe pipeline itself
        )
        for p in platforms if p.get("enabled", True)
    ]


@router.get("/video-ratios", response_model=VideoRatiosOut)
async def list_video_ratios(_: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Company-facing — the same developer-managed ratio list, so the
    Connections page's ratio dropdown offers exactly what's actually
    available, not a hardcoded set that could drift out of sync."""
    return VideoRatiosOut(ratios=await video_ratios_svc.get_video_ratios(db))


@router.get("", response_model=list[PlatformConnectionOut])
async def list_connections(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    available = await list_available_platforms(user, db)
    rows = (await db.scalars(select(PlatformConnection).where(PlatformConnection.company_id == user.company_id))).all()
    by_platform = {r.platform: r for r in rows}
    out = []
    for p in available:
        row = by_platform.get(p.id)
        if row:
            out.append(PlatformConnectionOut(platform=p.id, status=row.status, connected_at=row.connected_at))
        else:
            out.append(PlatformConnectionOut(platform=p.id, status="not_connected"))
    return out


@router.get("/linkedin_personal/connect")
async def linkedin_connect(user: User = Depends(require_role("admin")), db: AsyncSession = Depends(get_db)):
    """Kicks off the OAuth flow — returns the LinkedIn authorize URL for
    the frontend to redirect the browser to (not an automatic redirect
    itself, since this is called via fetch from Company Admin, not a
    raw link click)."""
    creds = await platform_config.get_platform_credentials(db, "linkedin_personal")
    if not creds or not creds["client_id"]:
        raise HTTPException(503, "LinkedIn isn't configured yet — ask the platform developer to add it in Developer > Platforms.")
    redirect_uri = creds["redirect_uri"] or f"{BACKEND_URL}/connections/linkedin_personal/callback"
    state = _sign_state(str(user.company_id))
    return {"authorize_url": linkedin.get_authorize_url(creds["client_id"], redirect_uri, creds["scope"], state)}


@router.get("/linkedin_personal/callback")
async def linkedin_callback(
    code: str | None = None, state: str | None = None, error: str | None = None,
    error_description: str | None = None, db: AsyncSession = Depends(get_db),
):
    """LinkedIn redirects the user's browser here directly (not an API
    call from the frontend) — so this responds with a redirect back
    into the app, not JSON, regardless of success or failure."""
    if error:
        return RedirectResponse(f"{settings.FRONTEND_URL}/app/connections?connection_error={error_description or error}")
    if not code or not state:
        return RedirectResponse(f"{settings.FRONTEND_URL}/app/connections?connection_error=Missing+code+or+state")

    try:
        company_id = _verify_state(state)
        creds = await platform_config.get_platform_credentials(db, "linkedin_personal")
        if not creds:
            raise RuntimeError("LinkedIn is no longer configured on this platform.")
        redirect_uri = creds["redirect_uri"] or f"{BACKEND_URL}/connections/linkedin_personal/callback"
        token_data = linkedin.exchange_code_for_token(code, creds["client_id"], creds["client_secret"], redirect_uri)
        access_token = token_data["access_token"]
        linkedin.get_person_urn(access_token)  # validates the token actually works before saving it
    except Exception as exc:  # noqa: BLE001
        return RedirectResponse(f"{settings.FRONTEND_URL}/app/connections?connection_error={str(exc)[:200]}")

    existing = await db.scalar(
        select(PlatformConnection).where(PlatformConnection.company_id == uuid.UUID(company_id), PlatformConnection.platform == "linkedin_personal")
    )
    encrypted = encrypt_token(access_token)
    if existing:
        existing.encrypted_token = encrypted
        existing.status = "connected"
        existing.connected_at = datetime.utcnow()
    else:
        db.add(PlatformConnection(company_id=uuid.UUID(company_id), platform="linkedin_personal", encrypted_token=encrypted, status="connected"))
    await db.commit()
    return RedirectResponse(f"{settings.FRONTEND_URL}/app/connections?connected=linkedin_personal")


@router.delete("/{platform}", status_code=204)
async def disconnect(platform: str, user: User = Depends(require_role("admin")), db: AsyncSession = Depends(get_db)):
    row = await db.scalar(select(PlatformConnection).where(PlatformConnection.company_id == user.company_id, PlatformConnection.platform == platform))
    if row:
        await db.delete(row)
        await db.commit()
