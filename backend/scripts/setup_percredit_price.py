"""One-time setup script: creates a NEW per-credit Stripe price ($0.90 per
credit) to replace the old flat "$9 for 10 credits" bundle price — this
lets customers buy any number of credits, not just fixed bundles of 10.

Run inside the api container:
    docker compose exec -e PYTHONPATH=/app api python scripts/setup_percredit_price.py

Safe to re-run: it always creates a NEW price (Stripe prices are
immutable) — just paste the newly printed value over the old
STRIPE_PRICE_TOPUP in .env.
"""
import stripe

from app.config import settings

stripe.api_key = settings.STRIPE_SECRET_KEY

PER_CREDIT_CENTS = 90  # $0.90 per credit — same rate as the original $9-for-10 bundle


def main():
    product = stripe.Product.create(name="NivaAd Credits (per-credit)")
    price = stripe.Price.create(
        product=product.id,
        unit_amount=PER_CREDIT_CENTS,
        currency="usd",
    )
    print(f"Created per-credit price: {price.id}  (${PER_CREDIT_CENTS/100:.2f} per credit)")
    print()
    print("=" * 70)
    print("Update this line in your .env file:")
    print("=" * 70)
    print(f"STRIPE_PRICE_TOPUP={price.id}")
    print("=" * 70)


if __name__ == "__main__":
    main()
