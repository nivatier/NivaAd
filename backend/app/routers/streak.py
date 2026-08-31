"""Brand Campaign Streak — router.

Generation is now async via Celery:
  POST /agent/streak/generate-ideas   create streak row + fire Celery task → returns {streak_id}
  GET  /agent/streak/streaks          list all streaks (with ads)
  GET  /agent/streak/streaks/{id}     get one streak with ads (used for polling)
  PATCH /agent/streak/ads/{id}        update a streak_ad
  POST /agent/streak/ads/{id}/schedule         schedule one ad
  POST /agent/streak/ads/schedule-all          schedule all idea-status ads
  DELETE /agent/streak/ads/{id}/cancel         cancel one ad
  DELETE /agent/streak/streaks/{id}            cancel entire streak
"""
from __future__ import annotations

import uuid
import re as _re
from datetime import datetime, date, timedelta

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.deps import get_current_user, get_db
from app.models import User, WebsiteStreak, StreakAd
from app.schemas import (
    StreakGenerateIn, StreakAdPatchIn,
    StreakScheduleAllIn, WebsiteStreakOut, StreakAdOut,
)

router = APIRouter(prefix="/agent/streak", tags=["streak"])

# ── Streak type config ─────────────────────────────────────────────────────────
STREAK_CONFIG = {
    "one_month":    {"per_week": 7},
    "two_months":   {"per_week": 3},
    "three_months": {"per_week": 3},
    "custom":       {"per_week": None},
}
THREE_PER_WEEK_DAYS = {0, 2, 4}  # Mon, Wed, Fri


# ── Helpers ───────────────────────────────────────────────────────────────────

def _auto_dates(streak_type: str, total_ads: int) -> list[str]:
    """Return ISO date strings for auto-distribution. Custom returns []."""
    if streak_type == "custom":
        return []
    cfg = STREAK_CONFIG.get(streak_type, {})
    per_week = cfg.get("per_week", 7)
    today = date.today()
    dates: list[str] = []
    current = today + timedelta(days=1)
    max_days = total_ads * 14
    day_count = 0
    while len(dates) < total_ads and day_count < max_days:
        if per_week == 7:
            dates.append(current.isoformat())
        elif per_week == 3 and current.weekday() in THREE_PER_WEEK_DAYS:
            dates.append(current.isoformat())
        current += timedelta(days=1)
        day_count += 1
    return dates


async def _scrape_url(url: str) -> tuple[str, str]:
    """Fetch and extract readable text. Returns (text[:6000], site_name)."""
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url, headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/125.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            })
            resp.raise_for_status()
    except Exception as exc:
        raise HTTPException(502, f"Could not fetch website: {exc}")

    soup = BeautifulSoup(resp.text, "html.parser")
    title_tag = soup.find("title")
    site_name = title_tag.get_text(strip=True)[:100] if title_tag else url

    for tag in soup(["script", "style", "noscript", "nav", "header",
                     "footer", "aside", "svg", "template", "form", "iframe"]):
        tag.decompose()
    main = soup.find("main") or soup
    raw = _re.sub(r"\s+", " ", main.get_text(separator=" ")).strip()
    return raw[:6000], site_name


def _streak_out(streak: WebsiteStreak) -> WebsiteStreakOut:
    return WebsiteStreakOut.model_validate(streak)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/generate-ideas", response_model=WebsiteStreakOut)
async def generate_streak_ideas(
    body: StreakGenerateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    1. Scrape the URL
    2. Create WebsiteStreak row with status='generating'
    3. Fire Celery task to generate ideas in batches
    4. Return streak immediately — frontend polls for status
    """
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    # Scrape synchronously in the API (fast, <3s)
    scraped, site_name = await _scrape_url(url)

    # Create streak row
    streak = WebsiteStreak(
        id=uuid.uuid4(),
        company_id=user.company_id,
        created_by=user.id,
        url=url,
        site_name=site_name,
        streak_type=body.streak_type,
        total_ads=body.total_ads,
        status="generating",
        scraped_content=scraped,
        posting_mode=body.posting_mode,
        generate_lead_hours=body.generate_lead_hours,
        content_type=body.content_type,
        image_model_id=body.image_model_id,
        created_at=datetime.utcnow(),
    )
    db.add(streak)
    await db.commit()
    await db.refresh(streak)

    # Fire Celery task (non-blocking)
    from app.worker import celery_app
    celery_app.send_task(
        "app.generate_streak_ideas_task",
        kwargs={
            "streak_id": str(streak.id),
            "streak_type": body.streak_type,
            "total_ads": body.total_ads,
            "timezone": body.timezone,
            "content_type": body.content_type,
            "image_model_id": body.image_model_id,
            "platforms": body.platforms,
        },
    )

    # Return streak (no ads yet — they'll appear as task runs)
    result = await db.execute(
        select(WebsiteStreak)
        .options(selectinload(WebsiteStreak.ads))
        .where(WebsiteStreak.id == streak.id)
    )
    return _streak_out(result.scalar_one())


@router.get("/streaks", response_model=list[WebsiteStreakOut])
async def list_streaks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all streaks for the company (including generating ones)."""
    result = await db.execute(
        select(WebsiteStreak)
        .options(selectinload(WebsiteStreak.ads))
        .where(
            WebsiteStreak.company_id == user.company_id,
            WebsiteStreak.status != "cancelled",
        )
        .order_by(WebsiteStreak.created_at.desc())
    )
    return [_streak_out(s) for s in result.scalars().all()]


@router.get("/streaks/{streak_id}", response_model=WebsiteStreakOut)
async def get_streak(
    streak_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get one streak with all ads. Frontend polls this until status='ideas_ready'."""
    result = await db.execute(
        select(WebsiteStreak)
        .options(selectinload(WebsiteStreak.ads))
        .where(WebsiteStreak.id == uuid.UUID(streak_id))
    )
    streak = result.scalar_one_or_none()
    if not streak or streak.company_id != user.company_id:
        raise HTTPException(404, "Streak not found.")
    return _streak_out(streak)


@router.patch("/ads/{ad_id}", response_model=StreakAdOut)
async def update_streak_ad(
    ad_id: str,
    body: StreakAdPatchIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ad = await db.get(StreakAd, uuid.UUID(ad_id))
    if not ad or ad.company_id != user.company_id:
        raise HTTPException(404, "Streak ad not found.")
    if ad.status in ("posted", "generating"):
        raise HTTPException(400, f"Cannot edit ad in status '{ad.status}'.")

    for field, val in body.model_dump(exclude_none=True).items():
        setattr(ad, field, val)

    await db.commit()
    await db.refresh(ad)
    return StreakAdOut.model_validate(ad)


@router.post("/ads/{ad_id}/schedule", response_model=StreakAdOut)
async def schedule_streak_ad(
    ad_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ad = await db.get(StreakAd, uuid.UUID(ad_id))
    if not ad or ad.company_id != user.company_id:
        raise HTTPException(404, "Streak ad not found.")
    if not ad.scheduled_date:
        raise HTTPException(400, "Set a scheduled date before scheduling.")
    if not ad.platforms:
        raise HTTPException(400, "Select at least one platform before scheduling.")
    if ad.status not in ("idea",):
        raise HTTPException(400, f"Ad is already in status '{ad.status}'.")

    ad.status = "scheduled"

    # Update parent streak status to 'active' if still 'ideas_ready'
    streak = await db.get(WebsiteStreak, ad.streak_id)
    if streak and streak.status == "ideas_ready":
        streak.status = "active"

    await db.commit()
    await db.refresh(ad)
    return StreakAdOut.model_validate(ad)


@router.post("/ads/schedule-all", response_model=list[StreakAdOut])
async def schedule_all_streak_ads(
    body: StreakScheduleAllIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StreakAd).where(
            StreakAd.streak_id == body.streak_id,
            StreakAd.company_id == user.company_id,
            StreakAd.status == "idea",
        )
    )
    ads = result.scalars().all()
    scheduled = []
    for ad in ads:
        if ad.scheduled_date and ad.platforms:
            ad.status = "scheduled"
            scheduled.append(ad)

    # Update streak status
    streak = await db.get(WebsiteStreak, body.streak_id)
    if streak and streak.status == "ideas_ready" and scheduled:
        streak.status = "active"

    await db.commit()
    for ad in scheduled:
        await db.refresh(ad)
    return [StreakAdOut.model_validate(a) for a in scheduled]


@router.delete("/ads/{ad_id}/cancel", response_model=StreakAdOut)
async def cancel_streak_ad(
    ad_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ad = await db.get(StreakAd, uuid.UUID(ad_id))
    if not ad or ad.company_id != user.company_id:
        raise HTTPException(404, "Streak ad not found.")
    if ad.status == "posted":
        raise HTTPException(400, "Cannot cancel an already-posted ad.")
    ad.status = "cancelled"
    await db.commit()
    await db.refresh(ad)
    return StreakAdOut.model_validate(ad)


@router.delete("/streaks/{streak_id}")
async def cancel_streak(
    streak_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WebsiteStreak)
        .options(selectinload(WebsiteStreak.ads))
        .where(WebsiteStreak.id == uuid.UUID(streak_id))
    )
    streak = result.scalar_one_or_none()
    if not streak or streak.company_id != user.company_id:
        raise HTTPException(404, "Streak not found.")

    # Hard delete for failed/generating streaks — no point keeping them
    if streak.status in ("failed", "generating"):
        for ad in streak.ads:
            await db.delete(ad)
        await db.delete(streak)
    else:
        # Soft cancel for active/ideas_ready streaks
        streak.status = "cancelled"
        for ad in streak.ads:
            if ad.status not in ("posted",):
                ad.status = "cancelled"

    await db.commit()
    return {"ok": True}
