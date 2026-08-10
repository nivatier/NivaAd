from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.services.log_handler import install_db_log_handler
from app.routers import (
    admin_capabilities, admin_overview, admin_users, ads, agent, analytics, auth,
    billing, brand_kit, campaigns, connections, developer, moderation, products, schedule, webhooks,
)

# Attach DB log handler early — before any router imports so startup
# errors are captured too. Only runs when a real DB URL is configured.
if settings.DATABASE_URL:
    install_db_log_handler(service="api", db_url=settings.DATABASE_URL)

app = FastAPI(
    title="NivaSpark API",
    version="0.14.0",
    docs_url=None if settings.ENV == "production" else "/docs",
    redoc_url=None if settings.ENV == "production" else "/redoc",
    openapi_url=None if settings.ENV == "production" else "/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(ads.router)
app.include_router(billing.router)
app.include_router(webhooks.router)
app.include_router(products.router)
app.include_router(brand_kit.router)
app.include_router(campaigns.router)
app.include_router(agent.router)
app.include_router(connections.router)
app.include_router(schedule.router)  # backend endpoints stay — My Ads calls them directly now, the standalone /app/schedule frontend page is what's being removed
app.include_router(moderation.router)
app.include_router(admin_users.router)
app.include_router(admin_capabilities.router)
app.include_router(admin_overview.router)
# admin_models.router REMOVED 2026-07-12 — model choice moved from a
# company-wide "active tier" setting to a per-ad dropdown in Create Ad
# (see ads.py's /ads/available-models), so there's nothing left for a
# company admin to configure here. Developer > Models is now the only
# place model definitions are managed.
app.include_router(developer.router)
app.include_router(analytics.router)


@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.ENV}
