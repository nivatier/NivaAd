from collections import Counter
from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_capability
from app.models import Ad, Campaign, CreditLedger, ScheduledPost, User
from app.schemas import AnalyticsOut, DayCountOut

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("", response_model=AnalyticsOut)
async def get_analytics(user: User = Depends(require_capability("view_analytics")), db: AsyncSession = Depends(get_db)):
    company_id = user.company_id
    now = datetime.utcnow()
    month_start = datetime.combine(now.replace(day=1).date(), time.min)
    thirty_days_ago = datetime.combine((now - timedelta(days=29)).date(), time.min)

    ads_created_total = await db.scalar(select(func.count()).select_from(Ad).where(Ad.company_id == company_id))
    ads_created_this_month = await db.scalar(
        select(func.count()).select_from(Ad).where(Ad.company_id == company_id, Ad.created_at >= month_start)
    )
    credits_used_this_month = (await db.scalar(
        select(func.coalesce(func.sum(CreditLedger.delta), 0))
        .where(CreditLedger.company_id == company_id, CreditLedger.delta < 0, CreditLedger.created_at >= month_start)
    )) or 0
    scheduled_pending = await db.scalar(
        select(func.count()).select_from(ScheduledPost)
        .where(ScheduledPost.company_id == company_id, ScheduledPost.status == "pending")
    )
    campaigns_total = await db.scalar(select(func.count()).select_from(Campaign).where(Campaign.company_id == company_id))

    # Ads-by-day for the last 30 days, zero-filled so the chart doesn't
    # have gaps on days with no activity.
    day_rows = (await db.execute(
        select(func.date(Ad.created_at), func.count())
        .where(Ad.company_id == company_id, Ad.created_at >= thirty_days_ago)
        .group_by(func.date(Ad.created_at))
    )).all()
    counts_by_date = {str(d): c for d, c in day_rows}
    ads_by_day = []
    for i in range(30):
        day = (thirty_days_ago + timedelta(days=i)).date()
        ads_by_day.append(DayCountOut(date=str(day), count=counts_by_date.get(str(day), 0)))

    # Platform + status breakdown computed from the ads themselves — for
    # a typical company's ad volume this is cheap enough to just do in
    # Python rather than an unnest() query, and it keeps the counting
    # logic simple and obviously correct.
    all_ads = (await db.execute(
        select(Ad.platforms, Ad.posted_platforms).where(Ad.company_id == company_id)
    )).all()
    platform_counter: Counter = Counter()
    for platforms, _posted in all_ads:
        for p in (platforms or []):
            platform_counter[p] += 1

    # Status breakdown uses the EXACT same signals as My Ads' own status
    # filter (ads.py) — posted_platforms coverage + pending schedule
    # existence — so these numbers always agree with what My Ads shows,
    # never a second, subtly-different way of counting the same thing.
    has_posted = func.json_array_length(Ad.posted_platforms) > 0
    has_pending_schedule_expr = exists(
        select(ScheduledPost.id).where(ScheduledPost.ad_id == Ad.id, ScheduledPost.status == "pending")
    )
    posted_count = await db.scalar(select(func.count()).select_from(Ad).where(Ad.company_id == company_id, has_posted))
    scheduled_count = await db.scalar(
        select(func.count()).select_from(Ad).where(Ad.company_id == company_id, has_pending_schedule_expr, ~has_posted)
    )
    created_count = await db.scalar(
        select(func.count()).select_from(Ad).where(Ad.company_id == company_id, ~has_posted, ~has_pending_schedule_expr)
    )

    return AnalyticsOut(
        ads_created_total=ads_created_total or 0,
        ads_created_this_month=ads_created_this_month or 0,
        credits_used_this_month=abs(credits_used_this_month),
        scheduled_pending=scheduled_pending or 0,
        campaigns_total=campaigns_total or 0,
        ads_by_day=ads_by_day,
        platform_breakdown=dict(platform_counter),
        status_breakdown={"created": created_count or 0, "scheduled": scheduled_count or 0, "posted": posted_count or 0},
    )
