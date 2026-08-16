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
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "NivaSpark <noreply@nivatier.com>"
    BACKEND_URL: str = "http://localhost:8000"
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    # ANTHROPIC_API_KEY / COPY_MODEL removed 2026-07-15 — every text
    # generation call (ad copy, campaign captions, the moderation
    # classifier) now routes through OpenRouter, same as image/video.
    # No more direct Anthropic access anywhere in this app.
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    IMAGE_MODEL: str = "google/gemini-2.5-flash-image"
    REGISTRATION_OPEN: bool = False   # when False only pre-approved emails can register
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    FACEBOOK_WEBHOOK_VERIFY_TOKEN: str = ""  # set in Railway env — used to verify Meta webhook calls
    # Growth tier retired 2026-08-02 — only starter and pro remain.
    # These are the live Stripe price IDs; override via Developer > Settings
    # without a redeploy if prices ever change.
    STRIPE_PRICE_IDS: str = (
        '{"starter":{' 
        '"1":"price_1TzvbJCJBGtf5GFheeQv0H5I",'
        '"3":"price_1TzvcPCJBGtf5GFhGXWCEmAt",'
        '"6":"price_1TzvcbCJBGtf5GFh4xWEVMmb",'
        '"12":"price_1TzvclCJBGtf5GFhXbR3R6G3"'
        '},"pro":{' 
        '"1":"price_1Tzvg5CJBGtf5GFhfmCXvJ55",'
        '"3":"price_1Tzvj4CJBGtf5GFhewfQBx8P",'
        '"6":"price_1TzvjGCJBGtf5GFhBcmTPxWT",'
        '"12":"price_1TzvjSCJBGtf5GFhL0EkTxOB"'
        '}}' 
    )
    STRIPE_PRICE_TOPUP: str = "price_1TyuBmCJBGtf5GFhvvkWxKYw"
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
    # Fallback only — the live value is stored in ModelConfig "pricing"
    # row and editable from Developer > Settings without a code deploy.
    # $0.10 per credit = the public "$0.10 = 1 credit" pricing.
    CREDIT_VALUE_USD: float = 0.10
    FRONTEND_URL: str = "http://localhost:5173"
    FERNET_KEY: str = ""
    MOCK_POSTING: bool = True
    CAROUSEL_MAX_IMAGES: int = 5   # server-enforced cap — the frontend has a matching constant in src/lib/constants.ts, keep both in sync if you change this
    DEVELOPER_EMAIL: str = ""      # platform-operator login — set in .env, checked directly, no database row at all
    DEVELOPER_PASSWORD: str = ""   # plaintext in .env, same trust boundary as JWT_SECRET/STRIPE_SECRET_KEY which already live there
    RAILWAY_API_TOKEN: str = ""    # Railway API token for billing/usage queries in developer panel
    RAILWAY_PROJECT_ID: str = ""   # Railway project UUID

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
