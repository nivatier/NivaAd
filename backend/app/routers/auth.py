import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import AuditLog, BrandKit, Company, CreditLedger, ModelConfig, Subscription, User, get_config_row
from app.schemas import (
    AcceptInviteIn, ChangePasswordIn, InviteCheckOut, LoginIn, MeOut, RefreshIn, RegisterIn,
    TokenOut, UpdateProfileIn, UserOut,
)
from app.services.capabilities import capabilities_for_user
from app.security import (
    create_access_token, create_refresh_token, decode_token, hash_password, verify_password,
)
import jwt

router = APIRouter(prefix="/auth", tags=["auth"])

FREE_PLAN_CREDITS = 3

VERIFY_TOKEN_MINUTES = 60 * 24  # 24 hours


def _make_verify_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "type": "email_verify",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=VERIFY_TOKEN_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _decode_verify_token(token: str) -> str:
    """Returns user_id or raises HTTPException."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(400, "Verification link has expired. Please register again.")
    except jwt.PyJWTError:
        raise HTTPException(400, "Invalid verification link.")
    if payload.get("type") != "email_verify":
        raise HTTPException(400, "Invalid verification link.")
    return payload["sub"]


# ── Launch config helpers (stored in ModelConfig singleton, "launch" key) ────
async def _get_launch_cfg(db: AsyncSession) -> dict:
    row = await get_config_row(db, "platform")
    cfg = (row.config if row else {}) or {}
    return cfg.get("launch", {})

async def _save_launch_cfg(db: AsyncSession, patch: dict) -> dict:
    row = await get_config_row(db, "platform")

    cfg = dict(row.config or {})
    cfg["launch"] = {**cfg.get("launch", {}), **patch}
    row.config = cfg
    flag_modified(row, "config")
    await db.commit()
    return cfg["launch"]


@router.get("/registration-status")
async def registration_status(db: AsyncSession = Depends(get_db)):
    """Public endpoint — frontend checks this to show or hide the registration form."""
    cfg = await _get_launch_cfg(db)
    return {"open": cfg.get("registration_open", settings.REGISTRATION_OPEN)}


@router.post("/register", status_code=201)
async def register(data: RegisterIn, db: AsyncSession = Depends(get_db)):
    if not data.accept_aup:
        raise HTTPException(400, "You must accept the Terms of Service and Acceptable Use Policy")

    # ── Registration gate ────────────────────────────────────────────
    cfg = await _get_launch_cfg(db)
    reg_open: bool = cfg.get("registration_open", settings.REGISTRATION_OPEN)
    if not reg_open:
        raise HTTPException(403, "Registration is currently disabled. Contact the platform team for access.")

    existing = await db.scalar(select(User).where(User.email == data.email.lower()))
    if existing:
        if existing.status == "pending":
            raise HTTPException(409, "PENDING_VERIFICATION: An account with this email is awaiting email verification. Please check your inbox or resend the verification email.")
        raise HTTPException(409, "An account with this email already exists")

    company = Company(name=data.company_name)
    db.add(company)
    await db.flush()

    user = User(
        company_id=company.id,
        email=data.email.lower(),
        password_hash=hash_password(data.password),
        full_name=data.full_name,
        role="admin",
        status="pending",          # blocked until email verified
        email_verified=False,
    )
    db.add(user)
    await db.flush()  # need user.id for the token

    db.add(Subscription(company_id=company.id, tier="free", monthly_credits=FREE_PLAN_CREDITS))
    db.add(CreditLedger(company_id=company.id, delta=FREE_PLAN_CREDITS, reason="plan_grant"))
    db.add(BrandKit(company_id=company.id))
    db.add(AuditLog(company_id=company.id, action="company.registered",
                    detail={"email": data.email.lower()}))
    await db.commit()

    # Send verification email (non-blocking — error is logged, not raised)
    verify_token = _make_verify_token(str(user.id))
    verify_url = f"{settings.FRONTEND_URL}/verify-email?token={verify_token}"
    try:
        from app.services import email as email_svc
        import asyncio
        await asyncio.to_thread(email_svc.send_verification_email, data.email.lower(), data.full_name, verify_url)
    except Exception as exc:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).error("[auth] Failed to send verification email to %s: %s", data.email.lower(), exc)

    return {"message": "Account created. Please check your email to verify your address before logging in."}


@router.post("/login", response_model=TokenOut)
async def login(data: LoginIn, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.email == data.email.lower()))
    # user.password_hash is None for an invited user who hasn't accepted
    # yet — check that BEFORE calling verify_password (which expects a
    # real hash string and would error on None), and give the exact same
    # generic error either way so a login attempt can't be used to probe
    # which emails exist or are mid-invite.
    if user is None or user.password_hash is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if user.status == "pending":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Please verify your email address before logging in. Check your inbox for the verification link.")
    if user.status != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Account is {user.status}")

    db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="user.login"))
    await db.commit()

    return TokenOut(
        access_token=create_access_token(str(user.id), str(user.company_id), user.role),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.get("/verify-email", response_model=TokenOut)
async def verify_email(token: str, db: AsyncSession = Depends(get_db)):
    """Called when the user clicks the link in their verification email.
    Activates the account and returns tokens so the frontend can log them
    straight in — no second login step needed."""
    user_id = _decode_verify_token(token)
    user = await db.get(User, uuid.UUID(user_id))
    if user is None:
        raise HTTPException(404, "Account not found.")
    if user.status == "active" and user.email_verified:
        # Already verified — just log them in again (idempotent)
        return TokenOut(
            access_token=create_access_token(str(user.id), str(user.company_id), user.role),
            refresh_token=create_refresh_token(str(user.id)),
        )
    if user.status != "pending":
        raise HTTPException(400, "This account cannot be verified.")
    user.status = "active"
    user.email_verified = True
    db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="user.email_verified"))
    await db.commit()
    return TokenOut(
        access_token=create_access_token(str(user.id), str(user.company_id), user.role),
        refresh_token=create_refresh_token(str(user.id)),
    )


RESEND_COOLDOWN_SECONDS = 60
RESEND_MAX_PER_HOUR = 5


def _resend_rate_check(email: str) -> tuple[bool, int]:
    """Returns (allowed, seconds_remaining).
    Uses Redis with two keys per email:
    - verify:cooldown:{email} — expires after RESEND_COOLDOWN_SECONDS
    - verify:count:{email}   — expires after 1 hour, incremented each send
    """
    try:
        import redis as redis_lib
        r = redis_lib.from_url(settings.REDIS_URL, decode_responses=True)
        cooldown_key = f"verify:cooldown:{email}"
        count_key = f"verify:count:{email}"

        # Check cooldown
        ttl = r.ttl(cooldown_key)
        if ttl > 0:
            return False, ttl

        # Check hourly cap
        count = int(r.get(count_key) or 0)
        if count >= RESEND_MAX_PER_HOUR:
            hour_ttl = r.ttl(count_key)
            return False, max(hour_ttl, 1)

        # Record this send
        pipe = r.pipeline()
        pipe.set(cooldown_key, "1", ex=RESEND_COOLDOWN_SECONDS)
        pipe.incr(count_key)
        pipe.expire(count_key, 3600)
        pipe.execute()
        return True, 0
    except Exception:
        # Redis unavailable — allow the send rather than block the user
        return True, 0


@router.post("/resend-verification")
async def resend_verification(data: LoginIn, db: AsyncSession = Depends(get_db)):
    """Lets a pending user request a new verification email.
    Rate limited: 60 s cooldown, max 5 per hour.
    Password is optional — we only need the email to find a pending account.
    Not revealing whether an account exists is less important here since
    the user just came from the registration flow."""
    import logging
    logger = logging.getLogger(__name__)
    email = data.email.lower()
    user = await db.scalar(select(User).where(User.email == email))

    if user and user.status == "pending":
        allowed, seconds_left = _resend_rate_check(email)
        if not allowed:
            raise HTTPException(429, f"Please wait {seconds_left} seconds before requesting another verification email.")

        verify_token = _make_verify_token(str(user.id))
        verify_url = f"{settings.FRONTEND_URL}/verify-email?token={verify_token}"
        try:
            from app.services import email as email_svc
            import asyncio
            await asyncio.to_thread(email_svc.send_verification_email, email, user.full_name, verify_url)
            logger.info("[auth] Verification email resent to %s", email)
        except Exception as exc:
            logger.error("[auth] Failed to resend verification email to %s: %s", email, exc)
            raise HTTPException(500, "Failed to send verification email. Please try again shortly.")

    return {"message": "If that account exists and is pending verification, a new link has been sent."}


@router.get("/invite/{token}", response_model=InviteCheckOut)
async def check_invite(token: str, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.invite_token == token, User.status == "invited"))
    if user is None:
        raise HTTPException(404, "This invite link is invalid or has already been used")
    company = await db.get(Company, user.company_id)
    inviter = await db.scalar(
        select(User).where(User.company_id == user.company_id, User.role == "admin", User.status == "active")
        .order_by(User.created_at.asc())
    )
    return InviteCheckOut(
        email=user.email, full_name=user.full_name, company_name=company.name if company else "",
        inviter_name=(inviter.full_name or inviter.email) if inviter else "Your team",
    )


@router.post("/accept-invite", response_model=TokenOut)
async def accept_invite(data: AcceptInviteIn, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.invite_token == data.token, User.status == "invited"))
    if user is None:
        raise HTTPException(404, "This invite link is invalid or has already been used")

    user.password_hash = hash_password(data.password)
    user.status = "active"
    user.email_verified = True
    user.invite_token = None  # single-use — can't be replayed once accepted
    if data.full_name:
        user.full_name = data.full_name

    db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="user.accepted_invite"))
    await db.commit()

    return TokenOut(
        access_token=create_access_token(str(user.id), str(user.company_id), user.role),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.post("/refresh", response_model=TokenOut)
async def refresh(data: RefreshIn, db: AsyncSession = Depends(get_db)):
    try:
        payload = decode_token(data.refresh_token)
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    if payload.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")

    user = await db.get(User, uuid.UUID(payload["sub"]))
    if user is None or user.status != "active":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")

    return TokenOut(
        access_token=create_access_token(str(user.id), str(user.company_id), user.role),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.get("/me", response_model=MeOut)
async def me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    company = await db.get(Company, user.company_id)
    sub = await db.scalar(
        select(Subscription).where(Subscription.company_id == user.company_id)
        .order_by(Subscription.created_at.desc())
    )
    credits = await db.scalar(
        select(func.coalesce(func.sum(CreditLedger.delta), 0))
        .where(CreditLedger.company_id == user.company_id)
    )
    caps = await capabilities_for_user(db, user)
    from app.services.billing import TIER_CREDITS
    plan_credits = sub.monthly_credits if sub and sub.monthly_credits else TIER_CREDITS.get(sub.tier if sub else "free", FREE_PLAN_CREDITS)
    return MeOut(
        user=UserOut.model_validate(user),
        company_id=company.id,
        company_name=company.name,
        tier=sub.tier if sub else "free",
        credits=float(credits or 0),
        plan_credits=plan_credits,
        term_months=sub.term_months if sub else 1,
        current_period_end=sub.current_period_end if sub else None,
        cancel_at_period_end=sub.cancel_at_period_end if sub else False,
        capabilities=caps,
    )


@router.patch("/me", response_model=UserOut)
async def update_profile(data: UpdateProfileIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Self-service — anyone can rename themselves. Not admin-gated: this
    only ever touches the CALLER's own row (get_current_user), never
    someone else's — unlike Admin > Users, which manages other people."""
    user.full_name = data.full_name.strip()
    db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="user.profile_updated"))
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/change-password")
async def change_password(data: ChangePasswordIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.password_hash is None or not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Current password is incorrect")
    user.password_hash = hash_password(data.new_password)
    db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="user.password_changed"))
    await db.commit()
    return {"ok": True}


# ── Public legal content — no auth required ──────────────────────────────────
@router.get("/legal-content")
async def public_legal_content(db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns Terms, Privacy, Acceptable Use and Cookies content.
    Called by the landing page footer popups without any authentication."""
    from app.models import get_config_row
    DEFAULT_LEGAL = {
        "terms": "Terms of Service content goes here.",
        "privacy": "Privacy Policy content goes here.",
        "acceptable_use": "Acceptable Use Policy content goes here.",
        "cookies": "We use cookies to improve your experience.",
    }
    row = await get_config_row(db, "platform")
    cfg = row.config if row and row.config else {}
    return {**DEFAULT_LEGAL, **cfg.get("legal", {})}
