import secrets
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_role
from app.models import Ad, AuditLog, Company, FlaggedContent, User
from app.schemas import InviteUserIn, TeamLimitOut, TeamUserOut, UpdateUserIn
from app.services import team_limits as team_limits_svc
from app.services.email import send_invite_email

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


@router.get("", response_model=list[TeamUserOut])
async def list_team(user: User = Depends(require_role("admin")), db: AsyncSession = Depends(get_db)):
    """Admin-only, like everything else under /admin/* — this used to be
    open to any active user, but that meant the whole team roster was
    readable by a direct API call even with the frontend page correctly
    hidden. Tightened for real defense-in-depth."""
    rows = (await db.scalars(
        select(User).where(User.company_id == user.company_id).order_by(User.created_at.asc())
    )).all()
    return rows


@router.get("/limit", response_model=TeamLimitOut)
async def get_team_limit_status(user: User = Depends(require_role("admin")), db: AsyncSession = Depends(get_db)):
    """Lets the Users page show 'X of Y used' and disable the invite
    form proactively, instead of only finding out on submit."""
    max_extra = await team_limits_svc.get_max_extra_users(db)
    extra_count = await db.scalar(
        select(func.count()).select_from(User).where(User.company_id == user.company_id, User.role != "admin")
    )
    return TeamLimitOut(max_extra_users=max_extra, current_extra_users=extra_count or 0)


@router.post("/invite", response_model=TeamUserOut, status_code=201)
async def invite_user(
    data: InviteUserIn, background: BackgroundTasks,
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    email = data.email.lower()
    existing = await db.scalar(select(User).where(User.email == email))
    if existing:
        raise HTTPException(409, "An account with this email already exists")

    max_extra = await team_limits_svc.get_max_extra_users(db)
    extra_count = await db.scalar(
        select(func.count()).select_from(User).where(User.company_id == user.company_id, User.role != "admin")
    )
    # Invited (not-yet-accepted) users count too — otherwise the limit
    # could be dodged by sending more invites than the cap and letting
    # them queue up, which defeats the "control users in the database"
    # goal this exists for.
    if extra_count >= max_extra:
        raise HTTPException(
            409,
            f"User addition limit reached — your plan allows {max_extra} team member{'s' if max_extra != 1 else ''} in addition to the admin. "
            f"Remove someone first, or contact support to increase your limit.",
        )

    company = await db.get(Company, user.company_id)
    token = secrets.token_urlsafe(32)
    invitee = User(
        company_id=user.company_id, email=email, full_name=data.full_name,
        role=data.role, status="invited", password_hash=None,
        invite_token=token, invited_at=datetime.utcnow(),
    )
    db.add(invitee)
    db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="user.invited",
                    detail={"invited_email": email, "role": data.role}))
    await db.commit()
    await db.refresh(invitee)

    accept_url = f"{settings.FRONTEND_URL}/accept-invite?token={token}"
    background.add_task(send_invite_email, email, data.full_name, user.full_name or user.email, company.name, accept_url)

    return invitee


@router.patch("/{user_id}", response_model=TeamUserOut)
async def update_team_member(
    user_id: uuid.UUID, data: UpdateUserIn,
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if target is None or target.company_id != user.company_id:
        raise HTTPException(404, "User not found")
    if target.id == user.id and (data.role and data.role != "admin" or data.status == "disabled"):
        raise HTTPException(400, "You can't demote or disable your own account — have another admin do it")
    if target.role == "admin" and data.role is not None and data.role != "admin":
        raise HTTPException(400, "Admin roles can't be changed from this screen — this protects against accidentally demoting another admin. Promoting someone TO admin is still fine.")

    changes = {}
    if data.role is not None and data.role != target.role:
        changes["role"] = {"from": target.role, "to": data.role}
        target.role = data.role
    if data.status is not None and data.status != target.status:
        changes["status"] = {"from": target.status, "to": data.status}
        target.status = data.status

    if changes:
        db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="user.updated",
                        detail={"target_user": str(user_id), **changes}))
    await db.commit()
    await db.refresh(target)
    return target


@router.delete("/{user_id}", status_code=204)
async def delete_team_member(
    user_id: uuid.UUID,
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """A real, permanent removal — different from the existing disable
    toggle, which is reversible and still counts against the team size
    limit. Deleting frees up that seat. Their past ads/audit history
    stays intact (attribution just becomes anonymous — created_by/
    user_id go to NULL, both columns were already nullable, no
    migration needed), so this doesn't quietly rewrite what actually
    happened, only who's still on the team."""
    target = await db.get(User, user_id)
    if target is None or target.company_id != user.company_id:
        raise HTTPException(404, "User not found")
    if target.id == user.id:
        raise HTTPException(400, "You can't delete your own account — have another admin do it")
    if target.role == "admin":
        other_admins = await db.scalar(
            select(func.count()).select_from(User).where(
                User.company_id == user.company_id, User.role == "admin", User.id != target.id,
            )
        )
        if not other_admins:
            raise HTTPException(400, "Can't delete the last admin — promote someone else to admin first, or this company would have no one able to manage it.")

    await db.execute(update(Ad).where(Ad.created_by == target.id).values(created_by=None))
    await db.execute(update(FlaggedContent).where(FlaggedContent.user_id == target.id).values(user_id=None))
    await db.execute(update(AuditLog).where(AuditLog.user_id == target.id).values(user_id=None))

    db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="user.deleted",
                    detail={"deleted_email": target.email, "deleted_role": target.role}))
    await db.delete(target)
    await db.commit()

