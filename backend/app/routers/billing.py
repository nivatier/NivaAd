from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import Subscription, User
from app.services import billing as billing_svc

router = APIRouter(prefix="/billing", tags=["billing"])

TIER_NAMES = {"starter", "growth", "pro"}
MIN_CREDITS = 1
MAX_CREDITS = 1000  # sane upper bound on a single purchase


async def _current_paid_sub(db: AsyncSession, company_id) -> Subscription | None:
    return await db.scalar(
        select(Subscription)
        .where(Subscription.company_id == company_id, Subscription.stripe_subscription_id.isnot(None))
        .order_by(Subscription.created_at.desc())
    )


@router.post("/checkout")
async def checkout(payload: dict, user: User = Depends(get_current_user)):
    tier = (payload.get("tier") or "").lower()
    term_months = int(payload.get("term_months") or 1)
    return_to = payload.get("return_to")
    if tier not in TIER_NAMES:
        raise HTTPException(422, f"tier must be one of {sorted(TIER_NAMES)}")
    if term_months not in (1, 3, 6, 12):
        raise HTTPException(422, "term_months must be 1, 3, 6, or 12")
    try:
        session = billing_svc.create_checkout_session(str(user.company_id), user.email, tier, term_months, return_to)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"url": session.url}


@router.post("/topup")
async def topup(payload: dict, user: User = Depends(get_current_user)):
    credits = int(payload.get("credits") or 10)
    return_to = payload.get("return_to")
    if not (MIN_CREDITS <= credits <= MAX_CREDITS):
        raise HTTPException(422, f"credits must be between {MIN_CREDITS} and {MAX_CREDITS}")
    session = billing_svc.create_topup_session(str(user.company_id), user.email, credits, return_to)
    return {"url": session.url}


@router.post("/portal")
async def portal(payload: dict | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sub = await _current_paid_sub(db, user.company_id)
    if sub is None or not sub.stripe_customer_id:
        raise HTTPException(400, "No billing account yet — choose a paid plan first.")
    return_to = (payload or {}).get("return_to")
    session = billing_svc.create_portal_session(sub.stripe_customer_id, return_to)
    return {"url": session.url}


@router.post("/cancel")
async def cancel(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sub = await _current_paid_sub(db, user.company_id)
    if sub is None or not sub.stripe_subscription_id or sub.status not in ("active", "trialing"):
        raise HTTPException(400, "No active paid subscription to cancel.")
    stripe_sub = billing_svc.cancel_at_period_end(sub.stripe_subscription_id)
    sub.cancel_at_period_end = True
    await db.commit()
    return {"cancel_at_period_end": True, "current_period_end": sub.current_period_end}


@router.post("/resume")
async def resume(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sub = await _current_paid_sub(db, user.company_id)
    if sub is None or not sub.stripe_subscription_id:
        raise HTTPException(400, "No subscription to resume.")
    billing_svc.resume_subscription(sub.stripe_subscription_id)
    sub.cancel_at_period_end = False
    await db.commit()
    return {"cancel_at_period_end": False}
