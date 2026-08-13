import logging
from datetime import datetime

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import AuditLog, CreditLedger, EmailSuppression, PostJob, Subscription

from app.services import billing as billing_svc

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger("nivaad.webhooks")

FREE_PLAN_CREDITS = 3


async def _expire_plan_credits(db: AsyncSession, company_id) -> float:
    """Expire (zero out) any remaining plan credits for a company.

    Calculates the current plan-credit balance (sum of plan_grant ledger
    rows minus usage) and if positive, inserts a negative adjustment row
    to zero it out.  Top-up credits (reason='topup') are intentionally
    excluded — those never expire.

    Returns the amount of credits expired (0.0 if nothing to expire).
    """
    from sqlalchemy import func as _func
    from app.models import AdCredit as _AC  # noqa: F401 — only used if model exists

    # Sum all plan_grant credits granted
    granted = await db.scalar(
        select(_func.coalesce(_func.sum(CreditLedger.delta), 0))
        .where(CreditLedger.company_id == company_id, CreditLedger.reason == "plan_grant")
    ) or 0

    # Sum all usage (negative deltas across all reasons)
    total_used = await db.scalar(
        select(_func.coalesce(_func.sum(CreditLedger.delta), 0))
        .where(CreditLedger.company_id == company_id, CreditLedger.delta < 0)
    ) or 0

    # Sum top-up credits separately so we don't expire them
    topup_granted = await db.scalar(
        select(_func.coalesce(_func.sum(CreditLedger.delta), 0))
        .where(CreditLedger.company_id == company_id, CreditLedger.reason == "topup")
    ) or 0

    # Plan balance = total credits - total used - topup credits
    # (topup credits are consumed first by convention in the credit system)
    plan_balance = float(granted) + float(total_used) - float(topup_granted)
    # Clamp — never expire more than what's there
    to_expire = max(0.0, plan_balance)

    if to_expire > 0:
        db.add(CreditLedger(
            company_id=company_id,
            delta=-to_expire,
            reason="plan_expiry",
        ))

    return to_expire


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
            monthly_credits = billing_svc.TIER_CREDITS.get(tier, 150)
            # current_period_end is on the Stripe subscription object
            cpe = stripe_sub.get("current_period_end")
            db.add(Subscription(
                company_id=company_id, tier=tier, term_months=term_months,
                status=stripe_sub["status"], monthly_credits=monthly_credits,
                stripe_customer_id=obj.get("customer"),
                stripe_subscription_id=obj.get("subscription"),
                cancel_at_period_end=bool(stripe_sub.get("cancel_at_period_end")),
                current_period_end=datetime.utcfromtimestamp(cpe) if cpe else None,
            ))
            # Grant ONE month of credits only — use-it-or-lose-it monthly model.
            # Expire any remaining plan credits from a previous plan first.
            checkout_ref = obj.get("id")
            existing_sub = await db.scalar(
                select(Subscription).where(
                    Subscription.company_id == company_id,
                    Subscription.stripe_subscription_id != obj.get("subscription"),
                    Subscription.tier.in_(["starter", "pro"]),
                ).order_by(Subscription.created_at.desc())
            )
            if existing_sub:
                await _expire_plan_credits(db, company_id)
            db.add(CreditLedger(
                company_id=company_id, delta=monthly_credits,
                reason="plan_grant", ref_id=checkout_ref,
            ))
            db.add(AuditLog(
                company_id=company_id, action="billing.subscription_started",
                detail={"tier": tier, "term_months": term_months, "credits_granted": monthly_credits},
            ))
        elif obj.get("mode") == "payment" and company_id:
            credits = int((obj.get("metadata") or {}).get("credits", 10))
            db.add(CreditLedger(company_id=company_id, delta=credits, reason="topup", ref_id=obj.get("id")))
            db.add(AuditLog(company_id=company_id, action="billing.topup", detail={"credits": credits}))

    elif etype == "invoice.paid":
        # Only handle monthly plan renewals here — multi-month and annual plans
        # get their monthly credit resets from the daily beat task instead,
        # since Stripe only fires invoice.paid once per billing period (which
        # for annual plans is once a year, not monthly).
        stripe_sub_id = obj.get("subscription")
        if stripe_sub_id:
            sub = await db.scalar(
                select(Subscription).where(Subscription.stripe_subscription_id == stripe_sub_id)
                .order_by(Subscription.created_at.desc())
            )
            if sub:
                invoice_ref = obj.get("id")
                period_end = obj.get("lines", {}).get("data", [{}])[0].get("period", {}).get("end")
                if period_end:
                    sub.current_period_end = datetime.utcfromtimestamp(period_end)
                sub.status = "active"

                # For monthly plans only: expire unused plan credits and grant fresh ones.
                # Multi-month/annual handled by reset_monthly_credits beat task.
                if sub.term_months == 1:
                    already_granted = await db.scalar(
                        select(CreditLedger).where(
                            CreditLedger.company_id == sub.company_id,
                            CreditLedger.ref_id == invoice_ref,
                            CreditLedger.reason == "plan_grant",
                        )
                    )
                    if not already_granted:
                        # Expire unused plan credits (use-it-or-lose-it)
                        unused = await _expire_plan_credits(db, sub.company_id)
                        monthly = billing_svc.TIER_CREDITS.get(sub.tier, sub.monthly_credits)
                        db.add(CreditLedger(
                            company_id=sub.company_id, delta=monthly,
                            reason="plan_grant", ref_id=invoice_ref,
                        ))
                        db.add(AuditLog(
                            company_id=sub.company_id, action="billing.monthly_credits_reset",
                            detail={"credits_granted": monthly, "credits_expired": unused},
                        ))

    elif etype == "customer.subscription.updated":
        sub = await db.scalar(
            select(Subscription).where(Subscription.stripe_subscription_id == obj["id"])
            .order_by(Subscription.created_at.desc())
        )
        if sub:
            old_tier = sub.tier
            old_term = sub.term_months

            # Sync tier/price if Stripe shows a different price (e.g. after upgrade)
            items = obj.get("items", {}).get("data", [])
            if items:
                price_id = items[0].get("price", {}).get("id")
                if price_id:
                    tier, term_months = billing_svc.reverse_lookup(price_id)
                    if tier and tier != sub.tier:
                        sub.tier = tier
                        sub.monthly_credits = billing_svc.TIER_CREDITS.get(tier, sub.monthly_credits)
                    if term_months and term_months != sub.term_months:
                        sub.term_months = term_months
            sub.status = obj["status"]
            sub.cancel_at_period_end = bool(obj.get("cancel_at_period_end"))
            cpe = obj.get("current_period_end")
            if cpe:
                sub.current_period_end = datetime.utcfromtimestamp(cpe)

            # If tier upgraded — expire old plan credits and grant new monthly allowance
            new_tier = sub.tier
            new_monthly = billing_svc.TIER_CREDITS.get(new_tier, sub.monthly_credits)
            old_monthly = billing_svc.TIER_CREDITS.get(old_tier, 0)
            TIER_RANK = {"free": 0, "starter": 1, "pro": 2}
            if TIER_RANK.get(new_tier, 0) > TIER_RANK.get(old_tier, 0):
                # Expire unused plan credits from old plan
                expired = await _expire_plan_credits(db, sub.company_id)
                # Grant fresh monthly credits for new plan
                db.add(CreditLedger(
                    company_id=sub.company_id,
                    delta=new_monthly,
                    reason="plan_grant",
                ))
                db.add(AuditLog(
                    company_id=sub.company_id, action="billing.upgrade_credits_reset",
                    detail={
                        "old_tier": old_tier, "new_tier": new_tier,
                        "credits_expired": expired, "credits_granted": new_monthly,
                    },
                ))

            db.add(AuditLog(
                company_id=sub.company_id, action="billing.subscription_updated",
                detail={"status": sub.status, "tier": sub.tier, "cancel_at_period_end": sub.cancel_at_period_end},
            ))

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


@router.post("/tiktok")
async def tiktok_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Receives async post-status notifications from TikTok's Content Posting API.

    TikTok calls this URL after processing a video or photo upload with the
    result (PUBLISH_COMPLETE or FAILED). We match the publish_id to the
    originating PostJob and update its failed/succeeded lists accordingly.

    TikTok sends a JSON body like:
      {
        "event": "post_publish_success" | "post_publish_fail",
        "publish_id": "v_pub_url~v2...",
        "error": {"code": 0, "message": ""},
        "extra": {"logid": "..."}
      }

    TikTok does not sign webhook payloads with a secret (as of v2 API) so we
    do not verify a signature here. We match solely on publish_id which is an
    unguessable opaque string returned by TikTok at post time.

    Setup in TikTok Developer Portal:
      Products > Webhooks > Callback URL:
      https://nivaad-production.up.railway.app/webhooks/tiktok
    """
    import json as _json

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    event = body.get("event", "")
    publish_id = body.get("publish_id", "")

    if not publish_id:
        # TikTok may also send a verification ping with just {"challenge": "..."}
        challenge = body.get("challenge")
        if challenge:
            # Respond to TikTok's URL verification challenge
            return {"challenge": challenge}
        logger.info("[tiktok_webhook] received event with no publish_id: %s", body)
        return {"received": True}

    logger.info("[tiktok_webhook] event=%s publish_id=%s", event, publish_id)

    # Find the PostJob that owns this publish_id

    # JSON array containment search — works on both PostgreSQL (with cast) and
    # falls back to a Python-side filter for smaller datasets.
    try:
        job = await db.scalar(
            select(PostJob).where(
                PostJob.tiktok_publish_ids.cast(
                    __import__("sqlalchemy.dialects.postgresql", fromlist=["JSONB"]).JSONB
                ).contains([publish_id])
            ).order_by(PostJob.created_at.desc()).limit(1)
        )
    except Exception:
        # Fallback: load recent jobs and filter in Python (safe for low volume)
        recent_jobs = (await db.scalars(
            select(PostJob)
            .where(PostJob.finished_at.is_(None))
            .order_by(PostJob.created_at.desc())
            .limit(200)
        )).all()
        job = next(
            (j for j in recent_jobs if publish_id in (j.tiktok_publish_ids or [])),
            None,
        )

    if not job:
        logger.warning("[tiktok_webhook] no PostJob found for publish_id=%s", publish_id)
        db.add(AuditLog(
            action="tiktok.webhook.unmatched",
            detail={"event": event, "publish_id": publish_id},
        ))
        await db.commit()
        return {"received": True}

    if event == "post_publish_success":
        succeeded = list(job.succeeded or [])
        if "tiktok" not in succeeded:
            succeeded.append("tiktok")
        job.succeeded = succeeded
        failed = dict(job.failed or {})
        failed.pop("tiktok", None)
        job.failed = failed
        logger.info("[tiktok_webhook] PostJob %s tiktok PUBLISHED ok", job.id)
        db.add(AuditLog(
            company_id=job.company_id,
            action="tiktok.post_published",
            detail={"publish_id": publish_id, "job_id": str(job.id)},
        ))

    elif event in ("post_publish_fail", "post_publish_canceled"):
        error_info = body.get("error") or {}
        fail_reason = error_info.get("message") or event
        failed = dict(job.failed or {})
        failed["tiktok"] = f"TikTok publish failed: {fail_reason}"
        job.failed = failed
        logger.warning(
            "[tiktok_webhook] PostJob %s tiktok FAILED: %s", job.id, fail_reason
        )
        db.add(AuditLog(
            company_id=job.company_id,
            action="tiktok.post_failed",
            detail={"publish_id": publish_id, "job_id": str(job.id), "reason": fail_reason},
        ))

    else:
        # e.g. processing status updates — log and ignore
        logger.info("[tiktok_webhook] unhandled event=%s for job=%s", event, job.id)

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
