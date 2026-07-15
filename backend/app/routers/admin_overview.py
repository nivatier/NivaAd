from datetime import datetime, time

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_role
from app.models import Ad, Campaign, CreditLedger, FlaggedContent, ScheduledPost, Subscription, User
from app.schemas import AdminOverviewOut

router = APIRouter(prefix="/admin/overview", tags=["admin-overview"])


@router.get("", response_model=AdminOverviewOut)
async def get_overview(user: User = Depends(require_role("admin")), db: AsyncSession = Depends(get_db)):
    """Real numbers for THIS company only — deliberately does not (and
    should never) show anything about other companies on the platform,
    even in aggregate."""
    company_id = user.company_id
    month_start = datetime.combine(datetime.utcnow().replace(day=1).date(), time.min)

    sub = await db.scalar(
        select(Subscription).where(Subscription.company_id == company_id)
        .order_by(Subscription.created_at.desc())
    )
    credits_remaining = (await db.scalar(
        select(func.coalesce(func.sum(CreditLedger.delta), 0)).where(CreditLedger.company_id == company_id)
    )) or 0
    # Credits USED this month = the negative side of the ledger only
    # (spending), not netted against grants/top-ups, so a mid-month
    # top-up doesn't make usage look smaller than it really was.
    credits_used_this_month = (await db.scalar(
        select(func.coalesce(func.sum(CreditLedger.delta), 0))
        .where(CreditLedger.company_id == company_id, CreditLedger.delta < 0, CreditLedger.created_at >= month_start)
    )) or 0

    team_members = await db.scalar(
        select(func.count()).select_from(User).where(User.company_id == company_id, User.status == "active")
    )
    ads_created_total = await db.scalar(select(func.count()).select_from(Ad).where(Ad.company_id == company_id))
    ads_created_this_month = await db.scalar(
        select(func.count()).select_from(Ad).where(Ad.company_id == company_id, Ad.created_at >= month_start)
    )
    campaigns_total = await db.scalar(select(func.count()).select_from(Campaign).where(Campaign.company_id == company_id))
    scheduled_pending = await db.scalar(
        select(func.count()).select_from(ScheduledPost)
        .where(ScheduledPost.company_id == company_id, ScheduledPost.status == "pending")
    )
    flagged_unresolved = await db.scalar(
        select(func.count()).select_from(FlaggedContent)
        .where(FlaggedContent.company_id == company_id, FlaggedContent.resolved.is_(False))
    )

    return AdminOverviewOut(
        tier=sub.tier if sub else "free",
        credits_remaining=credits_remaining,
        credits_used_this_month=abs(credits_used_this_month),
        team_members=team_members or 0,
        ads_created_total=ads_created_total or 0,
        ads_created_this_month=ads_created_this_month or 0,
        campaigns_total=campaigns_total or 0,
        scheduled_pending=scheduled_pending or 0,
        flagged_unresolved=flagged_unresolved or 0,
    )
