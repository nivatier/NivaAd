import logging
from datetime import datetime

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import AuditLog, CreditLedger, Subscription
from app.services import billing as billing_svc

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger("nivaad.webhooks")

FREE_PLAN_CREDITS = 3


async def _already_processed(db: AsyncSession, event_id: str) -> bool:
    rows = (await db.scalars(
        select(AuditLog).where(AuditLog.action == "stripe.webhook")
        .order_by(AuditLog.created_at.desc()).limit(500)
    )).all()
    return any((r.detail or {}).get("event_id") == event_id for r in rows)


@router.post("/stripe")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, settings.STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError) as exc:
        raise HTTPException(400, f"Invalid webhook signature/payload: {exc}")

    if await _already_processed(db, event["id"]):
        return {"received": True, "note": "already processed"}

    etype = event["type"]
    obj = event["data"]["object"]

    if etype == "checkout.session.completed":
        company_id = obj.get("client_reference_id") or (obj.get("metadata") or {}).get("company_id")
        if obj.get("mode") == "subscription" and company_id:
            stripe_sub = stripe.Subscription.retrieve(obj["subscription"])
            price_id = stripe_sub["items"]["data"][0]["price"]["id"]
            tier, term_months = billing_svc.reverse_lookup(price_id)
            db.add(Subscription(
                company_id=company_id, tier=tier or "starter", term_months=term_months or 1,
                status=stripe_sub["status"], monthly_credits=billing_svc.TIER_CREDITS.get(tier, 10),
                stripe_customer_id=obj.get("customer"), stripe_subscription_id=obj.get("subscription"),
                cancel_at_period_end=bool(stripe_sub.get("cancel_at_period_end")),
            ))
            db.add(AuditLog(company_id=company_id, action="billing.subscription_started",
                            detail={"tier": tier, "term_months": term_months}))
        elif obj.get("mode") == "payment" and company_id:
            credits = int((obj.get("metadata") or {}).get("credits", 10))
            db.add(CreditLedger(company_id=company_id, delta=credits, reason="topup", ref_id=obj.get("id")))
            db.add(AuditLog(company_id=company_id, action="billing.topup", detail={"credits": credits}))

    elif etype == "invoice.paid":
        stripe_sub_id = obj.get("subscription")
        if stripe_sub_id:
            sub = await db.scalar(
                select(Subscription).where(Subscription.stripe_subscription_id == stripe_sub_id)
                .order_by(Subscription.created_at.desc())
            )
            if sub:
                grant = billing_svc.TIER_CREDITS.get(sub.tier, sub.monthly_credits) * sub.term_months
                db.add(CreditLedger(company_id=sub.company_id, delta=grant, reason="plan_grant", ref_id=obj.get("id")))
                period_end = obj.get("lines", {}).get("data", [{}])[0].get("period", {}).get("end")
                if period_end:
                    sub.current_period_end = datetime.utcfromtimestamp(period_end)
                sub.status = "active"
                db.add(AuditLog(company_id=sub.company_id, action="billing.credits_granted",
                                detail={"credits": grant, "term_months": sub.term_months}))

    elif etype == "customer.subscription.updated":
        sub = await db.scalar(
            select(Subscription).where(Subscription.stripe_subscription_id == obj["id"])
            .order_by(Subscription.created_at.desc())
        )
        if sub:
            sub.status = obj["status"]
            sub.cancel_at_period_end = bool(obj.get("cancel_at_period_end"))
            cpe = obj.get("current_period_end")
            if cpe:
                sub.current_period_end = datetime.utcfromtimestamp(cpe)
            db.add(AuditLog(company_id=sub.company_id, action="billing.subscription_updated",
                            detail={"status": sub.status, "cancel_at_period_end": sub.cancel_at_period_end}))

    elif etype == "customer.subscription.deleted":
        # The paid period is over and Stripe has finalized the cancellation.
        # Mark the paid subscription canceled, then drop the company back to
        # a fresh Free-tier subscription — same shape as a new registration.
        sub = await db.scalar(
            select(Subscription).where(Subscription.stripe_subscription_id == obj["id"])
            .order_by(Subscription.created_at.desc())
        )
        if sub:
            sub.status = "canceled"
            db.add(Subscription(company_id=sub.company_id, tier="free", term_months=1,
                                status="active", monthly_credits=FREE_PLAN_CREDITS))
            db.add(CreditLedger(company_id=sub.company_id, delta=FREE_PLAN_CREDITS, reason="plan_grant"))
            db.add(AuditLog(company_id=sub.company_id, action="billing.reverted_to_free",
                            detail={"previous_tier": sub.tier}))

    else:
        logger.info("Unhandled Stripe event type: %s", etype)

    db.add(AuditLog(action="stripe.webhook", detail={"event_id": event["id"], "type": etype}))
    await db.commit()
    return {"received": True}
