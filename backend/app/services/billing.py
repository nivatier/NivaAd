"""Stripe billing: Checkout sessions, the Customer Portal, cancellation,
and price lookup.

Design: Stripe is the source of truth for billing state. We react to
webhooks rather than trusting the client-side redirect. Credits are
granted on invoice.paid (fires for the first payment AND every renewal),
NOT on checkout.session.completed — Stripe's own billing cycle drives
recurring credit grants with no extra scheduler needed.
"""
import json

import stripe

from app.config import settings

stripe.api_key = settings.STRIPE_SECRET_KEY

TIER_CREDITS = {"starter": 10, "growth": 30, "pro": 120}

_PRICE_MAP = None
_REVERSE_MAP = None


def _load_maps():
    global _PRICE_MAP, _REVERSE_MAP
    if _PRICE_MAP is None:
        _PRICE_MAP = json.loads(settings.STRIPE_PRICE_IDS or "{}")
        _REVERSE_MAP = {}
        for tier, terms in _PRICE_MAP.items():
            for term, price_id in terms.items():
                _REVERSE_MAP[price_id] = (tier, int(term))
    return _PRICE_MAP, _REVERSE_MAP


def price_id_for(tier: str, term_months: int) -> str:
    price_map, _ = _load_maps()
    try:
        return price_map[tier][str(term_months)]
    except KeyError:
        raise ValueError(f"No Stripe price configured for tier={tier} term={term_months}")


def reverse_lookup(price_id: str) -> tuple[str | None, int | None]:
    _, reverse_map = _load_maps()
    return reverse_map.get(price_id, (None, None))


def _safe_return_path(path: str | None) -> str:
    """Only allow internal app paths as a checkout redirect target — never
    an external URL, which would make this an open-redirect vector."""
    if not path or not path.startswith("/") or path.startswith("//") or ".." in path:
        return "/"
    return path


def create_checkout_session(company_id: str, email: str, tier: str, term_months: int, return_to: str | None = None):
    price_id = price_id_for(tier, term_months)
    path = _safe_return_path(return_to)
    return stripe.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        client_reference_id=company_id,
        customer_email=email,
        metadata={"company_id": company_id, "tier": tier, "term_months": str(term_months)},
        success_url=f"{settings.FRONTEND_URL}{path}?billing=success",
        cancel_url=f"{settings.FRONTEND_URL}{path}?billing=canceled",
    )


def create_topup_session(company_id: str, email: str, credits: int, return_to: str | None = None):
    """STRIPE_PRICE_TOPUP is a PER-CREDIT price ($0.90/credit) — quantity
    is the exact number of credits the customer chose, so the charged
    amount is always credits * $0.90, not a fixed bundle price."""
    path = _safe_return_path(return_to)
    return stripe.checkout.Session.create(
        mode="payment",
        line_items=[{"price": settings.STRIPE_PRICE_TOPUP, "quantity": credits}],
        client_reference_id=company_id,
        customer_email=email,
        metadata={"company_id": company_id, "credits": str(credits)},
        success_url=f"{settings.FRONTEND_URL}{path}?billing=topup-success",
        cancel_url=f"{settings.FRONTEND_URL}{path}?billing=canceled",
    )


def create_portal_session(stripe_customer_id: str, return_to: str | None = None):
    path = _safe_return_path(return_to)
    return stripe.billing_portal.Session.create(
        customer=stripe_customer_id,
        return_url=f"{settings.FRONTEND_URL}{path}",
    )


def cancel_at_period_end(stripe_subscription_id: str):
    """Schedules cancellation for the end of the current paid period —
    the customer keeps access and their plan until then, matching
    'cancel now, drop to Free once the paid period is used up'."""
    return stripe.Subscription.modify(stripe_subscription_id, cancel_at_period_end=True)


def resume_subscription(stripe_subscription_id: str):
    """Undoes a scheduled cancellation, if the customer changes their mind
    before the period ends."""
    return stripe.Subscription.modify(stripe_subscription_id, cancel_at_period_end=False)
