from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ENV: str = "development"
    DATABASE_URL: str = "postgresql+asyncpg://nivaad:nivaad_dev@localhost:5432/nivaad"
    REDIS_URL: str = "redis://localhost:6379/0"
    JWT_SECRET: str = "dev-change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_MINUTES: int = 30
    REFRESH_TOKEN_DAYS: int = 14
    S3_ENDPOINT_URL: str = "http://localhost:9000"
    S3_PUBLIC_URL: str = "http://localhost:9000"
    S3_BUCKET: str = "nivaad-media"
    S3_ACCESS_KEY: str = "nivaad"
    S3_SECRET_KEY: str = "nivaad_dev_secret"
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    # ANTHROPIC_API_KEY / COPY_MODEL removed 2026-07-15 — every text
    # generation call (ad copy, campaign captions, the moderation
    # classifier) now routes through OpenRouter, same as image/video.
    # No more direct Anthropic access anywhere in this app.
    OPENROUTER_API_KEY: str = ""
    IMAGE_MODEL: str = "google/gemini-2.5-flash-image"
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PRICE_IDS: str = "{}"   # JSON: {"starter":{"1":"price_..","3":"price_..."}, "growth":{...}, "pro":{...}}
    STRIPE_PRICE_TOPUP: str = ""   # one-time price id for the credit top-up
    # What one credit is actually worth in USD when a customer buys it —
    # MUST match whatever STRIPE_PRICE_TOPUP is configured to charge per
    # unit in Stripe (currently $0.90/credit). Used by services/pricing.py
    # to convert a computed dollar generation cost into a credit charge.
    # If you ever change the Stripe price, update this to match, or the
    # dynamic pricing calculator will be computing against a stale rate.
    # Re-pegged 2026-07-15 (was $0.90) — Option B from the text-pricing
    # discussion: halving this lets a 0.5-credit text cost become a
    # clean "1" without needing fractional-credit billing support.
    # IMPORTANT: dynamically-priced models (services/pricing.py) recompute
    # correctly against this automatically — but any model still on a
    # flat legacy "credits" number does NOT auto-adjust, since that
    # number isn't derived from this constant. Review Developer > Models
    # after deploying this and double any flat credit values you want to
    # keep at the same real dollar price.
    CREDIT_VALUE_USD: float = 0.45
    FRONTEND_URL: str = "http://localhost:5173"
    FERNET_KEY: str = ""
    MOCK_POSTING: bool = True
    CAROUSEL_MAX_IMAGES: int = 5   # server-enforced cap — the frontend has a matching constant in src/lib/constants.ts, keep both in sync if you change this
    DEVELOPER_EMAIL: str = ""      # platform-operator login — set in .env, checked directly, no database row at all
    DEVELOPER_PASSWORD: str = ""   # plaintext in .env, same trust boundary as JWT_SECRET/STRIPE_SECRET_KEY which already live there

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
