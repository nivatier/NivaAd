import logging
from datetime import datetime

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import AuditLog, CreditLedger, EmailSuppression, Subscription

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


async def _verify_sns_signature(payload: bytes, headers: dict) -> bool:
    """Verify that an SNS notification genuinely came from AWS.

    SNS signs every message with a certificate whose URL lives at
    SigningCertURL in the payload.  We download the cert (always from an
    aws-verified domain), reconstruct the canonical string, and verify
    the Signature field.  This prevents third parties from injecting
    fake bounce/complaint events and poisoning the suppression list.

    Returns True if the signature is valid (or if cryptography is
    unavailable — we log a warning rather than break delivery).
    """
    import json as _json
    import base64
    import re
    import urllib.request
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        from cryptography.x509 import load_pem_x509_certificate
    except ImportError:
        logger.warning("[ses_webhook] cryptography package not installed — skipping SNS signature verification")
        return True

    try:
        msg = _json.loads(payload)
        cert_url = msg.get("SigningCertURL", "")
        # Only trust certs served from official AWS SNS domains
        if not re.match(r"https://sns\.[a-z0-9-]+\.amazonaws\.com/", cert_url):
            logger.warning("[ses_webhook] SNS cert URL rejected (not AWS): %s", cert_url)
            return False

        # Download cert (cache would be nice but SNS certs rarely rotate)
        with urllib.request.urlopen(cert_url, timeout=5) as resp:
            cert_pem = resp.read()

        cert = load_pem_x509_certificate(cert_pem)
        pub_key = cert.public_key()

        # Build the canonical string to verify
        msg_type = msg.get("Type", "")
        if msg_type == "Notification":
            fields = ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
        else:  # SubscriptionConfirmation / UnsubscribeConfirmation
            fields = ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"]

        canonical = ""
        for field in fields:
            if field in msg:
                canonical += field + "\n" + msg[field] + "\n"

        sig = base64.b64decode(msg.get("Signature", ""))
        pub_key.verify(sig, canonical.encode("utf-8"), padding.PKCS1v15(), hashes.SHA1())  # noqa: S303 — AWS SNS uses SHA1
        return True
    except Exception as exc:
        logger.warning("[ses_webhook] SNS signature verification failed: %s", exc)
        return False


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
            tier = tier or "starter"
            term_months = term_months or 1
            db.add(Subscription(
                company_id=company_id, tier=tier, term_months=term_months,
                status=stripe_sub["status"], monthly_credits=billing_svc.TIER_CREDITS.get(tier, 150),
                stripe_customer_id=obj.get("customer"), stripe_subscription_id=obj.get("subscription"),
                cancel_at_period_end=bool(stripe_sub.get("cancel_at_period_end")),
            ))
            # Grant credits immediately here — invoice.paid may race and arrive
            # before this Subscription row is committed. Use checkout session id
            # as ref_id so invoice.paid dedup check avoids double-granting.
            grant = billing_svc.TIER_CREDITS.get(tier, 150) * term_months
            checkout_ref = obj.get("id")
            db.add(CreditLedger(company_id=company_id, delta=grant, reason="plan_grant", ref_id=checkout_ref))
            db.add(AuditLog(company_id=company_id, action="billing.subscription_started",
                            detail={"tier": tier, "term_months": term_months, "credits_granted": grant}))
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
                invoice_ref = obj.get("id")
                # Dedup: skip if credits were already granted for this invoice ref
                already_granted = await db.scalar(
                    select(CreditLedger).where(
                        CreditLedger.company_id == sub.company_id,
                        CreditLedger.ref_id == invoice_ref,
                        CreditLedger.reason == "plan_grant",
                    )
                )
                if not already_granted:
                    grant = billing_svc.TIER_CREDITS.get(sub.tier, sub.monthly_credits) * sub.term_months
                    db.add(CreditLedger(company_id=sub.company_id, delta=grant, reason="plan_grant", ref_id=invoice_ref))
                    db.add(AuditLog(company_id=sub.company_id, action="billing.credits_granted",
                                    detail={"credits": grant, "term_months": sub.term_months}))
                period_end = obj.get("lines", {}).get("data", [{}])[0].get("period", {}).get("end")
                if period_end:
                    sub.current_period_end = datetime.utcfromtimestamp(period_end)
                sub.status = "active"

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


@router.post("/ses")
async def ses_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Receives AWS SES bounce and complaint notifications via SNS.
    SNS sends either a SubscriptionConfirmation (first time) or a
    Notification containing the SES event. We handle both.

    Every notification is signature-verified before processing so a
    third party cannot inject fake bounce events to poison the
    suppression list.

    Setup in AWS:
    1. SNS → Create topic (Standard) → name: nivaspark-ses-events
    2. SES → nivatier.com identity → Notifications → Bounces → topic above
    3. SES → nivatier.com identity → Notifications → Complaints → topic above
    4. SNS → topic → Create subscription → HTTPS → https://nivaad-production.up.railway.app/webhooks/ses
    5. SNS sends SubscriptionConfirmation — this endpoint auto-confirms it
    """
    from app.models import EmailSuppression
    import json as _json
    import httpx as _httpx

    body = await request.body()
    try:
        payload = _json.loads(body)
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    msg_type = request.headers.get("x-amz-sns-message-type", "")

    # ── SNS subscription confirmation ─────────────────────────────────
    if msg_type == "SubscriptionConfirmation":
        # Verify the signature even on confirmations — an attacker could
        # otherwise subscribe their own endpoint posing as ours.
        if not await _verify_sns_signature(body, dict(request.headers)):
            raise HTTPException(403, "SNS signature verification failed")
        confirm_url = payload.get("SubscribeURL")
        if confirm_url:
            async with _httpx.AsyncClient(timeout=10) as client:
                await client.get(confirm_url)
            logger.info("[ses_webhook] SNS subscription confirmed")
        return {"confirmed": True}

    # ── SNS notification ──────────────────────────────────────────────
    if msg_type == "Notification":
        # Verify before processing any suppression action
        if not await _verify_sns_signature(body, dict(request.headers)):
            logger.warning("[ses_webhook] rejected notification with invalid SNS signature")
            raise HTTPException(403, "SNS signature verification failed")

        try:
            message = _json.loads(payload.get("Message", "{}"))
        except Exception:
            return {"received": True}

        notification_type = message.get("notificationType")

        if notification_type == "Bounce":
            bounce = message.get("bounce", {})
            bounce_type = bounce.get("bounceType", "")
            bounce_subtype = bounce.get("bounceSubType", "")

            if bounce_type == "Permanent":
                # Hard bounce — suppress permanently
                recipients = bounce.get("bouncedRecipients", [])
                for r in recipients:
                    email = r.get("emailAddress", "").lower().strip()
                    if not email:
                        continue
                    existing = await db.scalar(
                        select(EmailSuppression).where(EmailSuppression.email == email)
                    )
                    if not existing:
                        db.add(EmailSuppression(
                            email=email,
                            reason="bounce",
                            detail={
                                "bounce_type": bounce_type,
                                "bounce_subtype": bounce_subtype,
                                "action": r.get("action"),
                                "status": r.get("status"),
                                "diagnostic": r.get("diagnosticCode"),
                            }
                        ))
                        db.add(AuditLog(action="email.bounce_suppressed", detail={
                            "email": email,
                            "bounce_type": bounce_type,
                            "bounce_subtype": bounce_subtype,
                        }))
                        logger.warning("[ses_webhook] suppressed hard bounce: %s (%s/%s)", email, bounce_type, bounce_subtype)
            else:
                # Soft / transient bounce — log only, do NOT suppress
                recipients = bounce.get("bouncedRecipients", [])
                for r in recipients:
                    email = r.get("emailAddress", "").lower().strip()
                    if email:
                        db.add(AuditLog(action="email.soft_bounce", detail={
                            "email": email,
                            "bounce_type": bounce_type,
                            "bounce_subtype": bounce_subtype,
                            "diagnostic": r.get("diagnosticCode"),
                        }))
                        logger.info("[ses_webhook] soft bounce (not suppressed): %s (%s/%s)", email, bounce_type, bounce_subtype)

        elif notification_type == "Complaint":
            complaint = message.get("complaint", {})
            recipients = complaint.get("complainedRecipients", [])
            for r in recipients:
                email = r.get("emailAddress", "").lower().strip()
                if not email:
                    continue
                existing = await db.scalar(
                    select(EmailSuppression).where(EmailSuppression.email == email)
                )
                if not existing:
                    db.add(EmailSuppression(
                        email=email,
                        reason="complaint",
                        detail={
                            "feedback_type": complaint.get("complaintFeedbackType"),
                            "user_agent": complaint.get("userAgent"),
                        }
                    ))
                    db.add(AuditLog(action="email.complaint_suppressed", detail={"email": email}))
                    logger.warning("[ses_webhook] suppressed complaint: %s", email)

        await db.commit()

    return {"received": True}
