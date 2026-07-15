import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import AuditLog, BrandKit, Company, CreditLedger, Subscription, User
from app.schemas import (
    AcceptInviteIn, ChangePasswordIn, InviteCheckOut, LoginIn, MeOut, RefreshIn, RegisterIn,
    TokenOut, UpdateProfileIn, UserOut,
)
from app.services.capabilities import capabilities_for_user
from app.security import (
    create_access_token, create_refresh_token, decode_token, hash_password, verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

FREE_PLAN_CREDITS = 3


@router.post("/register", response_model=TokenOut, status_code=201)
async def register(data: RegisterIn, db: AsyncSession = Depends(get_db)):
    if not data.accept_aup:
        raise HTTPException(400, "You must accept the Terms of Service and Acceptable Use Policy")

    existing = await db.scalar(select(User).where(User.email == data.email.lower()))
    if existing:
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
        status="active",
    )
    db.add(user)

    db.add(Subscription(company_id=company.id, tier="free", monthly_credits=FREE_PLAN_CREDITS))
    db.add(CreditLedger(company_id=company.id, delta=FREE_PLAN_CREDITS, reason="plan_grant"))
    db.add(BrandKit(company_id=company.id))
    db.add(AuditLog(company_id=company.id, action="company.registered",
                    detail={"email": data.email.lower()}))
    await db.commit()

    return TokenOut(
        access_token=create_access_token(str(user.id), str(company.id), user.role),
        refresh_token=create_refresh_token(str(user.id)),
    )


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
    if user.status != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Account is {user.status}")

    db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="user.login"))
    await db.commit()

    return TokenOut(
        access_token=create_access_token(str(user.id), str(user.company_id), user.role),
        refresh_token=create_refresh_token(str(user.id)),
    )


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
    return MeOut(
        user=UserOut.model_validate(user),
        company_id=company.id,
        company_name=company.name,
        tier=sub.tier if sub else "free",
        credits=credits or 0,
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
