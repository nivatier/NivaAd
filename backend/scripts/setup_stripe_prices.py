"""One-time setup script: creates the NivaAd Products and Prices in your
Stripe SANDBOX (test mode) account, then prints the exact .env lines to
paste in.

Run inside the api container (it already has STRIPE_SECRET_KEY and the
stripe package):
    docker compose exec api python scripts/setup_stripe_prices.py

Safe to re-run: it always creates NEW prices (Stripe prices are
immutable), so if you re-run this you will get a fresh set of price IDs —
just paste the newly printed block over the old one in .env.
"""
import json

import stripe

from app.config import settings

stripe.api_key = settings.STRIPE_SECRET_KEY

# name, monthly $, credits/mo (must match frontend TIER_DATA)
TIERS = [
    ("Starter", 29, 10),
    ("Growth", 79, 30),
    ("Pro", 199, 120),
]
TERMS = [(1, 0.0), (3, 0.10), (6, 0.18), (12, 0.30)]  # (months, discount)


def main():
    price_map = {}
    for name, monthly, _credits in TIERS:
        product = stripe.Product.create(name=f"NivaAd {name}", metadata={"nivaad_tier": name.lower()})
        price_map[name.lower()] = {}
        for months, disc in TERMS:
            unit_amount = round(monthly * (1 - disc) * months * 100)  # cents, full period charge
            price = stripe.Price.create(
                product=product.id,
                unit_amount=unit_amount,
                currency="usd",
                recurring={"interval": "month", "interval_count": months},
                metadata={"nivaad_tier": name.lower(), "term_months": str(months)},
            )
            price_map[name.lower()][str(months)] = price.id
            print(f"  {name} / {months}mo -> {price.id}  (${unit_amount/100:.2f} every {months}mo)")

    topup_product = stripe.Product.create(name="NivaAd Credit Top-up")
    topup_price = stripe.Price.create(
        product=topup_product.id, unit_amount=900, currency="usd",  # $9 for 10 credits
    )
    print(f"  Top-up (10 credits) -> {topup_price.id}  ($9.00 one-time)")

    print("\n" + "=" * 70)
    print("Paste these two lines into your .env file:")
    print("=" * 70)
    print(f"STRIPE_PRICE_IDS={json.dumps(price_map)}")
    print(f"STRIPE_PRICE_TOPUP={topup_price.id}")
    print("=" * 70)


if __name__ == "__main__":
    main()
