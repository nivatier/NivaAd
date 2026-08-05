from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import AuditLog, CreditLedger, Subscription, User
from app.services import billing as billing_svc

router = APIRouter(prefix="/billing", tags=["billing"])

TIER_NAMES = {"starter", "pro"}
MIN_CREDITS = 50
MAX_CREDITS = 1000
TIER_RANK = {"free": 0, "starter": 1, "pro": 2}


async def _current_paid_sub(db: AsyncSession, company_id) -> Subscription | None:
    return await db.scalar(
        select(Subscription)
        .where(Subscription.company_id == company_id, Subscription.stripe_subscription_id.isnot(None))
        .order_by(Subscription.created_at.desc())
    )


@router.post("/checkout")
async def checkout(payload: dict, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Always routes through Stripe Checkout — for both new subscriptions
    and upgrades. Stripe shows the customer exactly what they'll be charged
    (including proration credit) before confirming. Downgrades are blocked
    here and redirected to the Customer Portal instead."""
    tier = (payload.get("tier") or "").lower()
    term_months = int(payload.get("term_months") or 1)
    return_to = payload.get("return_to")

    if tier not in TIER_NAMES:
        raise HTTPException(422, f"tier must be one of {sorted(TIER_NAMES)}")
    if term_months not in (1, 3, 6, 12):
        raise HTTPException(422, "term_months must be 1, 3, 6, or 12")

    existing_sub = await _current_paid_sub(db, user.company_id)
    current_tier = existing_sub.tier if existing_sub else "free"
    current_term = existing_sub.term_months if existing_sub else 1

    # ── Check if current term has ended or subscription is cancelled ──────
    # If the period has expired or the subscription is set to cancel at
    # period end, treat the user as free to pick any plan — no downgrade
    # restrictions apply since there's nothing left to prorate.
    from datetime import datetime, timezone
    period_ended = (
        existing_sub is None
        or existing_sub.status not in ("active", "trialing")
        or existing_sub.cancel_at_period_end  # scheduled to cancel — let them pick fresh
        or (
            existing_sub.current_period_end is not None
            and existing_sub.current_period_end < datetime.now(timezone.utc).replace(tzinfo=None)
        )
    )

    # ── Downgrade detection (only applies mid-cycle) ──────────────────────
    # Rules mid-cycle:
    #   Starter 6mo → Pro 6mo  ✅  same term, higher tier
    #   Starter 6mo → Pro 12mo ✅  longer term, higher tier
    #   Starter 6mo → Pro 3mo  ❌  shorter term — large proration credit risk
    #   Starter 6mo → Pro 1mo  ❌  shorter term — would pay nothing today
    #   Pro → Starter           ❌  tier downgrade
    # After term ends / cancel scheduled: anything is allowed
    if not period_ended:
        is_tier_downgrade = TIER_RANK.get(tier, 0) < TIER_RANK.get(current_tier, 0)
        is_term_downgrade = term_months < current_term
        if is_tier_downgrade or is_term_downgrade:
            raise HTTPException(
                400,
                "DOWNGRADE: To switch to a lower plan or shorter term mid-cycle, "
                "please use the 'Manage billing' option which will schedule the "
                "change for the end of your current billing period."
            )

    # ── Route through Stripe portal for upgrades, checkout for new subs ──
    # Existing paid subscriber upgrading → portal shows prorated amount
    # New customer or free → paid → Stripe Checkout
    if (
        existing_sub
        and existing_sub.stripe_subscription_id
        and existing_sub.stripe_customer_id
        and existing_sub.status in ("active", "trialing")
        and not period_ended
    ):
        try:
            session = billing_svc.create_portal_upgrade_session(
                existing_sub.stripe_customer_id,
                existing_sub.stripe_subscription_id,
                tier,
                term_months,
                return_to,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        return {"url": session.url}

    # New customer or post-period-end — fresh Stripe Checkout
    try:
        session = billing_svc.create_checkout_session(
            str(user.company_id),
            user.email,
            tier,
            term_months,
            return_to,
            stripe_customer_id=existing_sub.stripe_customer_id if existing_sub else None,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"url": session.url}


@router.get("/topup-info")
async def topup_info(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Returns the per-credit USD price from Developer > Settings (DB).
    Used by the Buy Credits modal — never hardcoded on the frontend."""
    from app.config import settings as _settings
    from app.models import get_config_row
    credit_value_usd = _settings.CREDIT_VALUE_USD  # .env fallback
    try:
        row = await get_config_row(db, "platform")
        if row and row.config:
            # _save_platform_cfg stores as config["platform"]["credit_value_usd"]
            v = row.config.get("platform", {}).get("credit_value_usd")
            if v is not None:
                credit_value_usd = float(v)
    except Exception:
        pass
    return {"credit_value_usd": credit_value_usd}


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
