"""Stripe billing: Checkout sessions, the Customer Portal, cancellation,
and price lookup.

Design: Stripe is the source of truth for billing state. We react to
webhooks rather than trusting the client-side redirect.

Credit grant strategy (use-it-or-lose-it monthly resets):
- On new subscription (checkout.session.completed): grant one month's
  credits only.
- On monthly plan renewal (invoice.paid): expire unused plan credits,
  grant fresh monthly credits.
- On annual/multi-month plans: Stripe fires invoice.paid once per year,
  so a daily Celery beat task handles monthly resets by checking each
  subscription's anniversary day.
- Top-up credits (purchased via "+ Buy") are tagged reason='topup' and
  are NEVER expired — they persist until used.

Price IDs are stored in the Developer > Settings > Platform config table
at runtime (no redeploy needed to change them), falling back to
STRIPE_PRICE_IDS / STRIPE_PRICE_TOPUP from .env if no DB override exists.
"""
import json

import stripe

from app.config import settings

stripe.api_key = settings.STRIPE_SECRET_KEY

TIER_CREDITS = {"starter": 150, "pro": 290}
# Growth tier retired — archived in Stripe, no new subscriptions.
# Free plan credits are defined as FREE_PLAN_CREDITS in auth.py / webhooks.py.

_PRICE_MAP = None
_REVERSE_MAP = None
_TOPUP_PRICE_ID: str | None = None


def invalidate_price_cache() -> None:
    """Call after updating Stripe price IDs in the DB so the new values
    take effect immediately without restarting the API process."""
    global _PRICE_MAP, _REVERSE_MAP, _TOPUP_PRICE_ID
    _PRICE_MAP = None
    _REVERSE_MAP = None
    _TOPUP_PRICE_ID = None


def _load_maps(db=None):
    """Build price maps from DB override first, .env fallback second.
    db is optional — if not provided the .env values are used directly
    (this keeps backwards compatibility for callers that don't pass a db
    session, e.g. the sync webhook handler)."""
    global _PRICE_MAP, _REVERSE_MAP, _TOPUP_PRICE_ID
    if _PRICE_MAP is not None:
        return _PRICE_MAP, _REVERSE_MAP

    price_ids_raw = settings.STRIPE_PRICE_IDS
    topup_raw     = settings.STRIPE_PRICE_TOPUP

    # Try to pull overrides from DB if a session is available
    if db is not None:
        try:
            from sqlalchemy import select as _select
            from app.models import get_config_row_sync as _get_cfg
            # Sync fetch — billing is called from sync Stripe webhook context
            row = _get_cfg(db, "platform")
            if row and row.config:
                platform = row.config
                if platform.get("stripe_price_ids"):
                    price_ids_raw = platform["stripe_price_ids"]
                if platform.get("stripe_price_topup"):
                    topup_raw = platform["stripe_price_topup"]
        except Exception:
            pass  # Any DB error falls back to .env values silently

    _PRICE_MAP = json.loads(price_ids_raw or "{}")
    _TOPUP_PRICE_ID = topup_raw or settings.STRIPE_PRICE_TOPUP
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


def get_topup_price_id() -> str:
    _load_maps()
    return _TOPUP_PRICE_ID or settings.STRIPE_PRICE_TOPUP


def _safe_return_path(path: str | None) -> str:
    """Only allow internal app paths as a checkout redirect target — never
    an external URL, which would make this an open-redirect vector."""
    if not path or not path.startswith("/") or path.startswith("//") or ".." in path:
        return "/"
    return path


def create_checkout_session(
    company_id: str,
    email: str,
    tier: str,
    term_months: int,
    return_to: str | None = None,
    stripe_customer_id: str | None = None,
):
    price_id = price_id_for(tier, term_months)
    path = _safe_return_path(return_to)
    kwargs: dict = dict(
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        client_reference_id=company_id,
        metadata={"company_id": company_id, "tier": tier, "term_months": str(term_months)},
        allow_promotion_codes=True,
        success_url=f"{settings.FRONTEND_URL}{path}?billing=success",
        cancel_url=f"{settings.FRONTEND_URL}{path}?billing=canceled",
    )
    if stripe_customer_id:
        kwargs["customer"] = stripe_customer_id   # link to existing customer, skip email step
    else:
        kwargs["customer_email"] = email
    return stripe.checkout.Session.create(**kwargs)


def create_topup_session(company_id: str, email: str, credits: int, return_to: str | None = None):
    """STRIPE_PRICE_TOPUP is a PER-CREDIT price — quantity is the exact
    number of credits the customer chose, so the charged amount is always
    credits × price_per_unit. Price ID read from DB override or .env."""
    path = _safe_return_path(return_to)
    topup_price = get_topup_price_id()
    return stripe.checkout.Session.create(
        mode="payment",
        line_items=[{"price": topup_price, "quantity": credits}],
        client_reference_id=company_id,
        customer_email=email,
        metadata={"company_id": company_id, "credits": str(credits)},
        allow_promotion_codes=True,   # enables promo/coupon code box at checkout
        success_url=f"{settings.FRONTEND_URL}{path}?billing=topup-success",
        cancel_url=f"{settings.FRONTEND_URL}{path}?billing=canceled",
    )


def create_portal_session(stripe_customer_id: str, return_to: str | None = None):
    path = _safe_return_path(return_to)
    return stripe.billing_portal.Session.create(
        customer=stripe_customer_id,
        return_url=f"{settings.FRONTEND_URL}{path}",
    )


def create_portal_upgrade_session(
    stripe_customer_id: str,
    stripe_subscription_id: str,
    tier: str,
    term_months: int,
    return_to: str | None = None,
):
    """Opens the Stripe Customer Portal pre-navigated to the plan change
    confirmation for the specified tier/term. Stripe shows the prorated
    amount due today on their own hosted page — fully trusted by the customer.
    Falls back to the generic portal if the flow isn't supported.
    Note: return_url does NOT include ?billing=success because the portal
    fires it on both confirm AND cancel — we can't distinguish here."""
    path = _safe_return_path(return_to)
    price_id = price_id_for(tier, term_months)
    try:
        return stripe.billing_portal.Session.create(
            customer=stripe_customer_id,
            return_url=f"{settings.FRONTEND_URL}{path}",  # no ?billing=success
            flow_data={
                "type": "subscription_update_confirm",
                "subscription_update_confirm": {
                    "subscription": stripe_subscription_id,
                    "items": [{"id": stripe.Subscription.retrieve(
                        stripe_subscription_id
                    )["items"]["data"][0]["id"], "price": price_id, "quantity": 1}],
                },
            },
        )
    except Exception:
        # Fall back to generic portal if flow_data not supported
        return create_portal_session(stripe_customer_id, return_to)


def cancel_at_period_end(stripe_subscription_id: str):
    """Schedules cancellation for the end of the current paid period —
    the customer keeps access and their plan until then, matching
    'cancel now, drop to Free once the paid period is used up'."""
    return stripe.Subscription.modify(stripe_subscription_id, cancel_at_period_end=True)


def upgrade_subscription(stripe_subscription_id: str, tier: str, term_months: int):
    """Upgrade or switch an existing Stripe subscription in place.

    - Switches to the new price immediately (billing_cycle_anchor='now')
    - Prorates the unused value of the old plan as a credit on the first
      invoice of the new plan (proration_behavior='create_prorations')
    - Returns the modified Stripe Subscription object
    """
    price_id = price_id_for(tier, term_months)
    stripe_sub = stripe.Subscription.retrieve(stripe_subscription_id)
    item_id = stripe_sub["items"]["data"][0]["id"]
    return stripe.Subscription.modify(
        stripe_subscription_id,
        items=[{"id": item_id, "price": price_id}],
        proration_behavior="create_prorations",
        billing_cycle_anchor="now",
        metadata={"tier": tier, "term_months": str(term_months)},
    )


def resume_subscription(stripe_subscription_id: str):
    """Undoes a scheduled cancellation, if the customer changes their mind
    before the period ends."""
    return stripe.Subscription.modify(stripe_subscription_id, cancel_at_period_end=False)
