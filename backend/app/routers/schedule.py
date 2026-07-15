import uuid
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_capability
from app.models import Ad, Campaign, ScheduledPost, User
from app.schemas import RescheduleIn, ScheduledPostOut, ScheduleListOut, SchedulePostIn
from app.services import retention as retention_svc

router = APIRouter(prefix="/schedule", tags=["schedule"])


async def _enrich(db: AsyncSession, sp: ScheduledPost, ad: Ad | None) -> ScheduledPostOut:
    campaign_name = None
    if ad and ad.campaign_id:
        campaign = await db.get(Campaign, ad.campaign_id)
        campaign_name = campaign.name if campaign else None
    return ScheduledPostOut(
        id=sp.id, ad_id=sp.ad_id, platform=sp.platform, scheduled_at=sp.scheduled_at,
        status=sp.status, posted_at=sp.posted_at,
        ad_title=(ad.brief or {}).get("product_name") if ad else None,
        campaign_id=ad.campaign_id if ad else None,
        campaign_name=campaign_name,
        campaign_phase=ad.campaign_phase if ad else None,
    )


@router.post("", response_model=list[ScheduledPostOut], status_code=201)
async def create_schedule(data: SchedulePostIn, user: User = Depends(require_capability("post_content")), db: AsyncSession = Depends(get_db)):
    """Schedules one row PER platform (so each platform's post can succeed,
    fail, or be canceled independently). Requires the ad to already have
    generated results."""
    ad = await db.get(Ad, data.ad_id)
    if ad is None or ad.company_id != user.company_id:
        raise HTTPException(404, "Ad not found")
    if ad.status not in ("ready", "posted", "scheduled"):
        raise HTTPException(409, f"Ad is not ready to schedule (status: {ad.status})")
    await retention_svc.validate_schedule_within_retention(db, ad.created_at, data.scheduled_at)

    rows = []
    for platform in data.platforms:
        sp = ScheduledPost(company_id=user.company_id, ad_id=ad.id, platform=platform, scheduled_at=data.scheduled_at)
        db.add(sp)
        rows.append(sp)
    ad.status = "scheduled"
    await db.commit()
    for r in rows:
        await db.refresh(r)

    # Build the full response explicitly (ad_title/campaign_* aren't real
    # columns on ScheduledPost — returning raw ORM rows here crashed with
    # a 500, since the response model expects those fields).
    return [await _enrich(db, r, ad) for r in rows]


@router.get("", response_model=ScheduleListOut)
async def list_schedule(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    date_from: date | None = None,
    date_to: date | None = None,
    status_filter: str | None = Query(None, pattern="^(scheduled|posted|canceled|failed)$"),
    user: User = Depends(require_capability("view_my_ads")),  # was view_schedule, removed since Schedule merged into My Ads
    db: AsyncSession = Depends(get_db),
):
    """Paginated by GROUP (distinct ad + exact scheduled_at), not by raw
    row, so a post scheduled to several platforms at once never gets
    split across two pages — see ScheduleListOut. date_from/date_to
    filter on scheduled_at (when it's due to fire, not when it was
    created). status_filter: "scheduled" maps to the stored "pending"
    status (matches the language used in the UI); "posted"/"canceled"/
    "failed" map directly."""
    stmt = select(ScheduledPost).where(ScheduledPost.company_id == user.company_id)
    if date_from:
        stmt = stmt.where(ScheduledPost.scheduled_at >= datetime.combine(date_from, time.min))
    if date_to:
        stmt = stmt.where(ScheduledPost.scheduled_at < datetime.combine(date_to + timedelta(days=1), time.min))
    if status_filter == "scheduled":
        stmt = stmt.where(ScheduledPost.status == "pending")
    elif status_filter:
        stmt = stmt.where(ScheduledPost.status == status_filter)

    rows = (await db.scalars(stmt.order_by(ScheduledPost.scheduled_at.desc()))).all()

    # Group by (ad_id, scheduled_at) — a post scheduled to N platforms in
    # one action is N rows but ONE group. `rows` is already sorted desc
    # by scheduled_at, and dict insertion order is preserved in Python,
    # so group_list comes out sorted too, with no extra sort needed.
    groups: dict[tuple[uuid.UUID, datetime], list[ScheduledPost]] = {}
    for r in rows:
        key = (r.ad_id, r.scheduled_at)
        groups.setdefault(key, []).append(r)
    group_list = list(groups.values())
    total_groups = len(group_list)

    start = (page - 1) * page_size
    page_groups = group_list[start:start + page_size]
    page_rows = [r for g in page_groups for r in g]

    # Batch-fetch the linked ads (for the title) and their campaigns (for
    # the campaign badge), instead of a query per row.
    ad_ids = {r.ad_id for r in page_rows}
    ads_by_id: dict[uuid.UUID, Ad] = {}
    if ad_ids:
        ad_rows = (await db.scalars(select(Ad).where(Ad.id.in_(ad_ids)))).all()
        ads_by_id = {a.id: a for a in ad_rows}

    camp_ids = {a.campaign_id for a in ads_by_id.values() if a.campaign_id}
    campaign_names: dict[uuid.UUID, str] = {}
    if camp_ids:
        camp_rows = (await db.scalars(select(Campaign).where(Campaign.id.in_(camp_ids)))).all()
        campaign_names = {c.id: c.name for c in camp_rows}

    items = []
    for r in page_rows:
        ad = ads_by_id.get(r.ad_id)
        title = (ad.brief or {}).get("product_name") if ad else None
        items.append(ScheduledPostOut(
            id=r.id, ad_id=r.ad_id, platform=r.platform, scheduled_at=r.scheduled_at,
            status=r.status, posted_at=r.posted_at, ad_title=title,
            campaign_id=ad.campaign_id if ad else None,
            campaign_name=campaign_names.get(ad.campaign_id) if ad and ad.campaign_id else None,
            campaign_phase=ad.campaign_phase if ad else None,
        ))

    return ScheduleListOut(items=items, total_groups=total_groups, page=page, page_size=page_size)


@router.delete("/{scheduled_id}", status_code=204)
async def cancel_schedule(scheduled_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sp = await db.get(ScheduledPost, scheduled_id)
    if sp is None or sp.company_id != user.company_id:
        raise HTTPException(404, "Scheduled post not found")
    if sp.status != "pending":
        raise HTTPException(409, f"Cannot cancel a post that is already {sp.status}")
    sp.status = "canceled"
    await db.commit()


@router.patch("/{scheduled_id}", response_model=ScheduledPostOut)
async def reschedule(scheduled_id: uuid.UUID, data: RescheduleIn, user: User = Depends(require_capability("post_content")), db: AsyncSession = Depends(get_db)):
    """Changes an EXISTING pending schedule's time — genuinely updates
    the same row (preserving its identity/id) rather than canceling and
    re-creating one, which is what lets My Ads offer a real "Reschedule"
    action from Preview/Repost, not just cancel-then-schedule-again."""
    sp = await db.get(ScheduledPost, scheduled_id)
    if sp is None or sp.company_id != user.company_id:
        raise HTTPException(404, "Scheduled post not found")
    if sp.status != "pending":
        raise HTTPException(409, f"Cannot reschedule a post that is already {sp.status}")
    ad = await db.get(Ad, sp.ad_id)
    if ad:
        await retention_svc.validate_schedule_within_retention(db, ad.created_at, data.scheduled_at)
    sp.scheduled_at = data.scheduled_at
    await db.commit()
    return await _enrich(db, sp, ad)
