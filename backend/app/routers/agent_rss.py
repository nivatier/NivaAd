"""RSS Feed Auto-Posting routers.

Developer router  (prefix /developer/rss, require_developer):
  GET    /developer/rss/feeds            — list all feeds (for dev panel)
  POST   /developer/rss/feeds            — add a feed
  PATCH  /developer/rss/feeds/{id}       — update a feed
  DELETE /developer/rss/feeds/{id}       — remove a feed

User router (prefix /agent/rss, get_current_user):
  GET    /agent/rss/feeds/catalogue      — list enabled feeds grouped by category
  GET    /agent/rss/subscriptions        — list company subscriptions
  POST   /agent/rss/subscriptions        — create subscription
  PATCH  /agent/rss/subscriptions/{id}   — update subscription settings
  DELETE /agent/rss/subscriptions/{id}   — delete subscription
  GET    /agent/rss/drafts               — list pending drafts
  POST   /agent/rss/drafts/{id}/approve  — approve draft and post the ad
  DELETE /agent/rss/drafts/{id}          — dismiss draft
"""
from datetime import datetime, timedelta
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_developer
from app.models import Ad, PostJob, RssFeed, RssFeedDraft, RssFeedSubscription, Subscription, User
from app.schemas import (
    RssFeedDraftOut,
    RssFeedIn,
    RssFeedOut,
    RssFeedSubscriptionIn,
    RssFeedSubscriptionOut,
    RssFeedSubscriptionPatchIn,
)
from app.worker import celery_app

router = APIRouter(prefix="/agent/rss", tags=["agent-rss"])
dev_router = APIRouter(prefix="/developer/rss", tags=["developer-rss"])


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _is_pro(db: AsyncSession, company_id: uuid.UUID) -> bool:
    """Return True if the company has an active Pro or Starter+ subscription."""
    sub = await db.scalar(
        select(Subscription)
        .where(Subscription.company_id == company_id, Subscription.status == "active")
        .order_by(Subscription.created_at.desc())
    )
    if sub is None:
        return False
    return sub.tier == "pro"


def _compute_generate_time(post_hour: int, post_minute: int, lead_minutes: int) -> tuple[int, int]:
    """Compute generate_hour and generate_minute from post time minus lead minutes.
    Returns (generate_hour, generate_minute) in UTC, wrapping midnight correctly."""
    total_minutes = post_hour * 60 + post_minute - lead_minutes
    # Wrap around midnight if needed (e.g. post=00:15, lead=30 → generate=23:45 previous day)
    total_minutes = total_minutes % (24 * 60)
    return total_minutes // 60, total_minutes % 60


def _compute_next_run(sub: RssFeedSubscription) -> datetime:
    """Calculate the next generation datetime using stored generate_hour/minute.
    These are pre-computed from post_time - lead_minutes and stored in the DB
    so the beat query is a simple next_run_at <= now comparison."""
    now = datetime.utcnow()
    h = sub.generate_hour   if sub.generate_hour   is not None else 8
    m = sub.generate_minute if sub.generate_minute is not None else 30
    if sub.frequency == "daily":
        candidate = now.replace(hour=h, minute=m, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate
    elif sub.frequency == "weekly":
        dow = sub.day_of_week if sub.day_of_week is not None else 0  # default Monday
        days_ahead = (dow - now.weekday()) % 7
        if days_ahead == 0:
            days_ahead = 7
        next_dt = (now + timedelta(days=days_ahead)).replace(hour=h, minute=m, second=0, microsecond=0)
        return next_dt
    else:  # monthly
        dom = sub.day_of_month if sub.day_of_month is not None else 1
        try:
            candidate = now.replace(day=dom, hour=h, minute=m, second=0, microsecond=0)
        except ValueError:
            import calendar
            last_day = calendar.monthrange(now.year, now.month)[1]
            candidate = now.replace(day=last_day, hour=h, minute=m, second=0, microsecond=0)
        if candidate <= now:
            if now.month == 12:
                candidate = candidate.replace(year=now.year + 1, month=1)
            else:
                candidate = candidate.replace(month=now.month + 1)
        return candidate


def _sub_out(sub: RssFeedSubscription, feed: RssFeed | None = None) -> RssFeedSubscriptionOut:
    return RssFeedSubscriptionOut(
        id=sub.id,
        company_id=sub.company_id,
        rss_feed_id=sub.rss_feed_id,
        custom_url=sub.custom_url,
        label=sub.label,
        content_type=sub.content_type,
        image_model_id=sub.image_model_id,
        video_model_id=sub.video_model_id,
        platforms=sub.platforms or [],
        posting_mode=sub.posting_mode,
        frequency=sub.frequency,
        post_hour=sub.post_hour if sub.post_hour is not None else 9,
        post_minute=sub.post_minute if sub.post_minute is not None else 0,
        generate_lead_minutes=sub.generate_lead_minutes if sub.generate_lead_minutes is not None else 30,
        generate_hour=sub.generate_hour if sub.generate_hour is not None else 8,
        generate_minute=sub.generate_minute if sub.generate_minute is not None else 30,
        include_logo=sub.include_logo if sub.include_logo is not None else True,
        day_of_week=sub.day_of_week,
        day_of_month=sub.day_of_month,
        posts_per_run=sub.posts_per_run,
        article_selection=sub.article_selection,
        tone_style=sub.tone_style,
        enabled=sub.enabled,
        last_run_at=sub.last_run_at,
        next_run_at=sub.next_run_at,
        created_at=sub.created_at,
        feed_name=feed.name if feed else None,
        feed_category=feed.category if feed else None,
    )


def _draft_out(draft: RssFeedDraft, sub: RssFeedSubscription | None = None, feed: RssFeed | None = None) -> RssFeedDraftOut:
    return RssFeedDraftOut(
        id=draft.id,
        company_id=draft.company_id,
        subscription_id=draft.subscription_id,
        article_url=draft.article_url,
        article_title=draft.article_title,
        article_summary=draft.article_summary,
        ad_id=draft.ad_id,
        status=draft.status,
        expires_at=draft.expires_at,
        created_at=draft.created_at,
        subscription_label=sub.label if sub else None,
        feed_name=feed.name if feed else (sub.custom_url if sub else None),
    )


# ── Developer: Feed Management  (dev_router → /developer/rss/...) ────────────

@dev_router.get("/feeds", response_model=list[RssFeedOut])
async def list_feeds(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """List all developer-managed feeds (including disabled)."""
    rows = (await db.scalars(
        select(RssFeed).order_by(RssFeed.category, RssFeed.name)
    )).all()
    return [RssFeedOut.model_validate(r) for r in rows]


@dev_router.post("/feeds", response_model=RssFeedOut, status_code=201)
async def add_feed(data: RssFeedIn, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """Add a new developer-managed RSS feed."""
    existing = await db.scalar(select(RssFeed).where(RssFeed.url == data.url))
    if existing:
        raise HTTPException(409, "A feed with that URL already exists.")
    feed = RssFeed(
        name=data.name, url=data.url, category=data.category,
        description=data.description, enabled=data.enabled,
    )
    db.add(feed)
    await db.commit()
    await db.refresh(feed)
    return RssFeedOut.model_validate(feed)


@dev_router.patch("/feeds/{feed_id}", response_model=RssFeedOut)
async def update_feed(feed_id: str, data: RssFeedIn, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """Update a developer-managed RSS feed."""
    feed = await db.get(RssFeed, uuid.UUID(feed_id))
    if feed is None:
        raise HTTPException(404, "Feed not found.")
    feed.name = data.name
    feed.url = data.url
    feed.category = data.category
    feed.description = data.description
    feed.enabled = data.enabled
    await db.commit()
    await db.refresh(feed)
    return RssFeedOut.model_validate(feed)


@dev_router.delete("/feeds/{feed_id}", status_code=204)
async def delete_feed(feed_id: str, _: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """Remove a developer-managed RSS feed."""
    feed = await db.get(RssFeed, uuid.UUID(feed_id))
    if feed is None:
        raise HTTPException(404, "Feed not found.")
    await db.delete(feed)
    await db.commit()


# ── User: Feed Catalogue  (router → /agent/rss/...) ─────────────────────────

@router.get("/feeds/catalogue")
async def feed_catalogue(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """List enabled developer feeds grouped by category — for all users."""
    feeds = (await db.scalars(
        select(RssFeed).where(RssFeed.enabled == True).order_by(RssFeed.category, RssFeed.name)
    )).all()
    grouped: dict[str, list] = {}
    for f in feeds:
        cat = f.category
        if cat not in grouped:
            grouped[cat] = []
        grouped[cat].append(RssFeedOut.model_validate(f))
    return grouped


# ── User: Subscriptions ───────────────────────────────────────────────────────

@router.get("/subscriptions", response_model=list[RssFeedSubscriptionOut])
async def list_subscriptions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """List all RSS feed subscriptions for this company."""
    subs = (await db.scalars(
        select(RssFeedSubscription)
        .where(RssFeedSubscription.company_id == user.company_id)
        .order_by(RssFeedSubscription.created_at.desc())
    )).all()
    results = []
    for sub in subs:
        feed = None
        if sub.rss_feed_id:
            feed = await db.get(RssFeed, sub.rss_feed_id)
        results.append(_sub_out(sub, feed))
    return results


@router.post("/subscriptions", response_model=RssFeedSubscriptionOut, status_code=201)
async def create_subscription(
    data: RssFeedSubscriptionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new RSS feed subscription.
    Pro-only restriction: custom URLs (no rss_feed_id) require a Pro plan.
    """
    # Validate: must have either rss_feed_id or custom_url
    if not data.rss_feed_id and not data.custom_url:
        raise HTTPException(422, "Provide either rss_feed_id (developer feed) or custom_url (Pro only).")
    if data.custom_url and not data.rss_feed_id:
        # Custom URL — Pro required
        if not await _is_pro(db, user.company_id):
            raise HTTPException(403, "Custom RSS feeds are available on the Pro plan. Upgrade to add your own feed URLs.")

    feed: RssFeed | None = None
    if data.rss_feed_id:
        feed = await db.get(RssFeed, data.rss_feed_id)
        if feed is None or not feed.enabled:
            raise HTTPException(404, "That developer feed was not found or is disabled.")

    sub = RssFeedSubscription(
        company_id=user.company_id,
        rss_feed_id=data.rss_feed_id,
        custom_url=data.custom_url,
        label=data.label,
        content_type=data.content_type,
        image_model_id=data.image_model_id,
        video_model_id=data.video_model_id,
        platforms=data.platforms,
        posting_mode=data.posting_mode,
        frequency=data.frequency,
        post_hour=data.post_hour,
        post_minute=data.post_minute,
        generate_lead_minutes=data.generate_lead_minutes,
        generate_hour=_compute_generate_time(data.post_hour, data.post_minute, data.generate_lead_minutes)[0],
        generate_minute=_compute_generate_time(data.post_hour, data.post_minute, data.generate_lead_minutes)[1],
        include_logo=data.include_logo,
        day_of_week=data.day_of_week,
        day_of_month=data.day_of_month,
        posts_per_run=data.posts_per_run,
        article_selection=data.article_selection,
        tone_style=data.tone_style,
        enabled=data.enabled,
    )
    sub.next_run_at = _compute_next_run(sub)
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return _sub_out(sub, feed)


@router.patch("/subscriptions/{sub_id}", response_model=RssFeedSubscriptionOut)
async def update_subscription(
    sub_id: str,
    data: RssFeedSubscriptionPatchIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing subscription's settings."""
    sub = await db.get(RssFeedSubscription, uuid.UUID(sub_id))
    if sub is None or sub.company_id != user.company_id:
        raise HTTPException(404, "Subscription not found.")

    if data.label is not None:
        sub.label = data.label
    if data.content_type is not None:
        sub.content_type = data.content_type
    if data.image_model_id is not None:
        sub.image_model_id = data.image_model_id
    if data.video_model_id is not None:
        sub.video_model_id = data.video_model_id
    if data.platforms is not None:
        sub.platforms = data.platforms
    if data.posting_mode is not None:
        sub.posting_mode = data.posting_mode
    if data.article_selection is not None:
        sub.article_selection = data.article_selection
    if data.tone_style is not None:
        sub.tone_style = data.tone_style
    if data.posts_per_run is not None:
        sub.posts_per_run = data.posts_per_run
    if data.enabled is not None:
        sub.enabled = data.enabled

    # Re-schedule if frequency/day/hour/minute settings changed
    freq_changed = any(v is not None for v in [data.frequency, data.day_of_week, data.day_of_month, data.post_hour, data.post_minute, data.generate_lead_minutes])
    if data.frequency is not None:
        sub.frequency = data.frequency
    if data.post_hour is not None:
        sub.post_hour = data.post_hour
    if data.post_minute is not None:
        sub.post_minute = data.post_minute
    if data.generate_lead_minutes is not None:
        sub.generate_lead_minutes = data.generate_lead_minutes
    if data.include_logo is not None:
        sub.include_logo = data.include_logo
    # Recompute generate_hour/minute whenever post time or lead changes
    if any(v is not None for v in [data.post_hour, data.post_minute, data.generate_lead_minutes]):
        ph = sub.post_hour if sub.post_hour is not None else 9
        pm = sub.post_minute if sub.post_minute is not None else 0
        lead = sub.generate_lead_minutes if sub.generate_lead_minutes is not None else 30
        sub.generate_hour, sub.generate_minute = _compute_generate_time(ph, pm, lead)
    if data.day_of_week is not None:
        sub.day_of_week = data.day_of_week
    if data.day_of_month is not None:
        sub.day_of_month = data.day_of_month
    if freq_changed:
        sub.next_run_at = _compute_next_run(sub)

    await db.commit()
    await db.refresh(sub)
    feed = None
    if sub.rss_feed_id:
        feed = await db.get(RssFeed, sub.rss_feed_id)
    return _sub_out(sub, feed)


@router.delete("/subscriptions/{sub_id}", status_code=204)
async def delete_subscription(sub_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Delete a subscription (and all its seen-item / draft records via CASCADE)."""
    sub = await db.get(RssFeedSubscription, uuid.UUID(sub_id))
    if sub is None or sub.company_id != user.company_id:
        raise HTTPException(404, "Subscription not found.")
    await db.delete(sub)
    await db.commit()


# ── User: Drafts (manual-approval mode) ─────────────────────────────────────

@router.get("/drafts", response_model=list[RssFeedDraftOut])
async def list_drafts(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """List all pending (non-expired) drafts for this company."""
    now = datetime.utcnow()
    drafts = (await db.scalars(
        select(RssFeedDraft)
        .where(
            RssFeedDraft.company_id == user.company_id,
            RssFeedDraft.status == "pending",
            RssFeedDraft.expires_at > now,
        )
        .order_by(RssFeedDraft.created_at.desc())
    )).all()
    results = []
    for draft in drafts:
        sub = await db.get(RssFeedSubscription, draft.subscription_id)
        feed = None
        if sub and sub.rss_feed_id:
            feed = await db.get(RssFeed, sub.rss_feed_id)
        results.append(_draft_out(draft, sub, feed))
    return results


@router.post("/drafts/{draft_id}/approve", status_code=200)
async def approve_draft(draft_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Approve a pending draft — this triggers posting the associated ad to all subscribed platforms."""
    draft = await db.get(RssFeedDraft, uuid.UUID(draft_id))
    if draft is None or draft.company_id != user.company_id:
        raise HTTPException(404, "Draft not found.")
    if draft.status != "pending":
        raise HTTPException(409, f"Draft is already {draft.status}.")
    if draft.expires_at < datetime.utcnow():
        raise HTTPException(410, "This draft has expired. Run the feed again to generate a fresh one.")
    if not draft.ad_id:
        raise HTTPException(422, "No ad is linked to this draft — it may still be generating.")

    # Get the subscription to know which platforms to post to
    sub = await db.get(RssFeedSubscription, draft.subscription_id)
    if not sub:
        raise HTTPException(404, "Subscription not found.")

    draft.status = "approved"
    ad = await db.get(Ad, draft.ad_id)
    if ad:
        ad.status = "ready"

    # Create a PostJob so post_ad_now can track per-platform results
    platforms = sub.platforms or []
    post_job_id: str | None = None
    if platforms and draft.ad_id:
        post_job = PostJob(
            company_id=user.company_id,
            ad_id=draft.ad_id,
            platforms=platforms,
            status="queued",
            succeeded=[],
            failed={},
        )
        db.add(post_job)
        await db.flush()
        post_job_id = str(post_job.id)

    await db.commit()

    if post_job_id:
        celery_app.send_task("app.post_ad_now", args=[post_job_id])

    return {"ok": True, "ad_id": str(draft.ad_id) if draft.ad_id else None}


@router.delete("/drafts/{draft_id}", status_code=204)
async def dismiss_draft(draft_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Dismiss a pending draft without posting it.
    Also deletes the associated Ad so it doesn't linger in My Ads —
    keeping both views in sync regardless of which one the user acts from."""
    from sqlalchemy import delete as _delete, update as _update
    from app.models import AgentRecommendation, GenerationJob, PostJob, ScheduledPost, StreakAd
    draft = await db.get(RssFeedDraft, uuid.UUID(draft_id))
    if draft is None or draft.company_id != user.company_id:
        raise HTTPException(404, "Draft not found.")
    ad_id = draft.ad_id
    # Delete the draft first (FK constraint on ads)
    await db.delete(draft)
    await db.flush()
    # Delete the associated ad and its dependents if it exists
    if ad_id:
        ad = await db.get(Ad, ad_id)
        if ad and ad.company_id == user.company_id:
            await db.execute(_delete(GenerationJob).where(GenerationJob.ad_id == ad_id))
            await db.execute(_delete(PostJob).where(PostJob.ad_id == ad_id))
            await db.execute(_delete(ScheduledPost).where(ScheduledPost.ad_id == ad_id))
            await db.execute(_update(AgentRecommendation).where(AgentRecommendation.created_ad_id == ad_id).values(created_ad_id=None))
            await db.execute(_update(StreakAd).where(StreakAd.ad_id == ad_id).values(ad_id=None))
            await db.delete(ad)
    await db.commit()


# ── Feed health probe (shared logic used by both the endpoint and the task) ──

def _probe_feed(url: str) -> dict:
    """Synchronously fetch + parse an RSS/Atom feed and return a health result.
    Returns dict: { ok, article_count, latest_title, error }
    Uses httpx (already imported in tasks.py; import locally here too)."""
    import httpx as _httpx
    import xml.etree.ElementTree as ET

    try:
        resp = _httpx.get(
            url, timeout=15, follow_redirects=True,
            headers={"User-Agent": "NivaSpark/1.0 HealthCheck"},
        )
        resp.raise_for_status()
    except _httpx.TimeoutException:
        return {"ok": False, "article_count": 0, "latest_title": None, "error": "Request timed out (>15 s)"}
    except _httpx.HTTPStatusError as exc:
        return {"ok": False, "article_count": 0, "latest_title": None, "error": f"HTTP {exc.response.status_code}"}
    except Exception as exc:
        return {"ok": False, "article_count": 0, "latest_title": None, "error": str(exc)[:200]}

    try:
        root = ET.fromstring(resp.text)
    except ET.ParseError as exc:
        return {"ok": False, "article_count": 0, "latest_title": None, "error": f"XML parse error: {exc}"}

    # RSS 2.0
    channel = root.find("channel")
    if channel is not None:
        items = channel.findall("item")
        first_title = items[0].findtext("title") if items else None
        return {"ok": True, "article_count": len(items), "latest_title": first_title, "error": None}

    # Atom
    atom_ns = "http://www.w3.org/2005/Atom"
    entries = root.findall(f"{{{atom_ns}}}entry")
    if entries:
        first_title = entries[0].findtext(f"{{{atom_ns}}}title")
        return {"ok": True, "article_count": len(entries), "latest_title": first_title, "error": None}

    return {"ok": False, "article_count": 0, "latest_title": None, "error": "No items or entries found in feed"}


# ── Developer: manual re-check endpoint ──────────────────────────────────────

@dev_router.post("/feeds/{feed_id}/check")
async def check_feed_health(
    feed_id: str,
    _: str = Depends(require_developer),
    db: AsyncSession = Depends(get_db),
):
    """Probe a single feed right now and persist the result.
    Returns the health result immediately so the UI can update inline."""
    feed = await db.get(RssFeed, uuid.UUID(feed_id))
    if feed is None:
        raise HTTPException(404, "Feed not found.")

    import asyncio as _asyncio
    result = await _asyncio.get_event_loop().run_in_executor(None, _probe_feed, feed.url)

    now = datetime.utcnow()
    feed.last_checked_at = now
    feed.last_status = "ok" if result["ok"] else "error"
    feed.last_error = result["error"]
    feed.last_article_count = result["article_count"] if result["ok"] else feed.last_article_count
    await db.commit()

    return {
        "ok": result["ok"],
        "article_count": result["article_count"],
        "latest_title": result["latest_title"],
        "error": result["error"],
        "checked_at": now.isoformat(),
    }


# ── Developer: RSS health-check interval settings ────────────────────────────

@dev_router.get("/settings")
async def get_rss_settings(_: str = Depends(require_developer), db: AsyncSession = Depends(get_db)):
    """Return RSS-specific developer settings."""
    from app.services.retention import get_rss_health_interval_days
    return {"health_check_interval_days": await get_rss_health_interval_days(db)}


@dev_router.put("/settings")
async def update_rss_settings(
    body: dict,
    _: str = Depends(require_developer),
    db: AsyncSession = Depends(get_db),
):
    """Update RSS-specific developer settings (currently: health_check_interval_days)."""
    from app.services.retention import set_rss_health_interval_days
    days = int(body.get("health_check_interval_days", 7))
    if not (1 <= days <= 365):
        raise HTTPException(422, "health_check_interval_days must be 1–365")
    await set_rss_health_interval_days(db, days)
    return {"health_check_interval_days": days}


# ── User: Get Ideas from RSS Feed ────────────────────────────────────────────

@router.post("/get-ideas")
async def get_ideas_from_feed(
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch a live RSS feed, let AI pick the best articles based on selection
    preference only. Tone, copy directions and link injection happen entirely
    on the frontend per-article before navigating to Create Ad.
    Charges 0.25 credits (same as quick-spark).

    Body:
      rss_feed_id: str | None  — developer catalogue feed
      custom_url:  str | None  — Pro user\'s custom URL
      article_selection: str   — most_recent | most_relevant | most_trending | most_educational | most_controversial | positive_only
      count: int               — 1-6 articles to return (default 4)

    Returns: { feed_name, ideas: [{ index, title, url, summary, goal }] }
    """
    import json as _json
    from app.routers.agent import IDEA_GEN_COST, _charge_idea_credits

    # ── Resolve feed URL ─────────────────────────────────────────────
    rss_feed_id = body.get("rss_feed_id")
    custom_url = (body.get("custom_url") or "").strip()

    if rss_feed_id:
        feed = await db.get(RssFeed, uuid.UUID(str(rss_feed_id)))
        if not feed or not feed.enabled:
            raise HTTPException(404, "Feed not found or disabled.")
        feed_url = feed.url
        feed_name = feed.name
    elif custom_url:
        feed_url = custom_url
        feed_name = custom_url
    else:
        raise HTTPException(422, "Provide rss_feed_id or custom_url.")

    article_selection = body.get("article_selection", "most_recent")
    count = min(max(int(body.get("count", 4)), 1), 6)

    # ── Charge credits ────────────────────────────────────────────────
    await _charge_idea_credits(db, user, "idea_gen_rss_feed")
    await db.commit()

    # ── Fetch and parse the RSS feed ──────────────────────────────────
    import httpx as _httpx
    import xml.etree.ElementTree as ET

    try:
        resp = _httpx.get(feed_url, timeout=15, follow_redirects=True,
                          headers={"User-Agent": "NivaSpark/1.0 RSS Reader"})
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
    except _httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"Could not fetch feed: HTTP {exc.response.status_code}")
    except Exception as exc:
        raise HTTPException(502, f"Could not fetch feed: {exc}")

    # Parse articles
    articles: list[dict] = []
    atom_ns = "http://www.w3.org/2005/Atom"
    channel = root.find("channel")
    if channel is not None:
        for item in channel.findall("item")[:30]:
            link = (item.findtext("link") or "").strip()
            title = (item.findtext("title") or "").strip()
            desc = (item.findtext("description") or "").strip()
            if link and title:
                articles.append({"url": link, "title": title, "summary": desc[:400]})
    else:
        for entry in root.findall(f"{{{atom_ns}}}entry")[:30]:
            link_el = entry.find(f"{{{atom_ns}}}link")
            link = (link_el.get("href") if link_el is not None else "") or ""
            title = (entry.findtext(f"{{{atom_ns}}}title") or "").strip()
            summary = (entry.findtext(f"{{{atom_ns}}}summary") or "").strip()
            if link and title:
                articles.append({"url": link, "title": title, "summary": summary[:400]})

    if not articles:
        raise HTTPException(422, "No articles found in this feed. The feed may be empty or in an unsupported format.")

    # ── AI picks best N articles based on selection preference only ───
    from app.config import settings
    from app.services.text_gen import CHAT_URL

    pref_desc = {
        "most_relevant":       "most relevant and useful to a business audience",
        "most_trending":       "most likely to be trending or viral right now",
        "most_recent":         "most recently published — bias toward the top of the list",
        "most_educational":    "most educational and informative",
        "most_controversial":  "most likely to spark discussion and engagement",
        "positive_only":       "most positive and uplifting",
    }.get(article_selection, "most relevant")

    articles_json = _json.dumps(
        [{"index": i, "title": a["title"], "summary": a["summary"][:200]}
         for i, a in enumerate(articles)],
        ensure_ascii=False,
    )

    system_prompt = f"""You are a content strategist and visual director helping a business create social media ads from RSS articles.

Given a list of RSS articles, pick the {count} that are {pref_desc}.
For each picked article, also provide:
1. A suitable ad goal
2. A detailed image generation prompt that visually represents the article's topic — suitable for an AI image model. The prompt should describe the scene, mood, lighting, and style in plain English. It must be specific and vivid, NOT generic. Do not include any text, logos, or words in the image description.

Return ONLY a JSON array — no markdown, no prose, no backticks:
[
  {{
    "index": <original article index>,
    "title": "<article title>",
    "summary": "<one concise sentence summarising the article>",
    "goal": "<Drive engagement|Brand awareness|Educate audience|Start conversation>",
    "image_prompt": "<detailed visual scene description for AI image generation — specific, vivid, photorealistic or illustrative style, no text or logos>"
  }}
]
Pick exactly {count} articles."""

    try:
        ai_resp = _httpx.post(
            CHAT_URL,
            headers={
                "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "anthropic/claude-sonnet-4-5",
                "max_tokens": 1500,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Articles from {feed_name}:\n{articles_json}"},
                ],
            },
            timeout=60,
        )
        ai_resp.raise_for_status()
    except Exception as exc:
        raise HTTPException(502, f"AI error: {exc}")

    raw = (ai_resp.json().get("choices") or [{}])[0].get("message", {}).get("content", "[]")
    try:
        ideas = _json.loads(raw.replace("```json", "").replace("```", "").strip())
    except Exception:
        raise HTTPException(500, "Could not parse AI response — try again.")

    # ── Enrich with original article URLs ────────────────────────────
    for idea in ideas:
        idx = idea.get("index", 0)
        if 0 <= idx < len(articles):
            idea["url"] = articles[idx]["url"]
            if not idea.get("summary"):
                idea["summary"] = articles[idx]["summary"]
        else:
            idea["url"] = ""
        # image_prompt is returned from the AI — no fallback needed here,
        # the frontend falls back to deriveImageScene if missing

    return {
        "feed_name": feed_name,
        "ideas": ideas,
    }


@router.post("/scrape-article")
async def scrape_article_for_ad(
    body: dict,
    user: User = Depends(get_current_user),
):
    """Scrape a single article URL and return an LLM-generated summary
    suitable for pre-filling the Copy Directions field in Create Ad.

    Body:
      url:   str  — the article URL to scrape
      title: str  — article title (used in the summary header)

    Returns:
      { summary: str, title: str, url: str }

    No credits charged — this is a lightweight helper for the Create Ad flow,
    not a generation step. Scraping is done via httpx (simple GET, not
    Playwright) since article pages are typically plain HTML without heavy
    JS rendering requirements.
    """
    import httpx as _httpx
    import re as _re
    from bs4 import BeautifulSoup as _BS
    from app.config import settings
    from app.services.text_gen import CHAT_URL

    url = (body.get("url") or "").strip()
    title = (body.get("title") or "").strip()

    if not url or not url.startswith(("http://", "https://")):
        raise HTTPException(422, "A valid article URL is required.")

    # ── Fetch the article page ────────────────────────────────────────
    try:
        resp = _httpx.get(
            url,
            timeout=20,
            follow_redirects=True,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/125.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        resp.raise_for_status()
    except _httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"Could not fetch article: HTTP {exc.response.status_code}")
    except Exception as exc:
        raise HTTPException(502, f"Could not fetch article: {exc}")

    # ── Extract readable text ─────────────────────────────────────────
    soup = _BS(resp.text, "html.parser")
    # Remove noise tags
    for tag in soup(["script", "style", "noscript", "nav", "header", "footer",
                     "aside", "svg", "template", "form", "iframe"]):
        tag.decompose()

    # Try to find the main article body first
    article_body = (
        soup.find("article")
        or soup.find(attrs={"class": _re.compile(r"article|post|content|entry|story", _re.I)})
        or soup.find("main")
        or soup
    )
    raw_text = _re.sub(r"\s+", " ", article_body.get_text(separator=" ")).strip()

    # Cap at 6000 chars to stay within LLM context budget
    article_text = raw_text[:6000]

    if len(article_text) < 100:
        raise HTTPException(422, "Could not extract meaningful content from this article. The page may require JavaScript or a login.")

    # ── LLM summarise ─────────────────────────────────────────────────
    system_prompt = """You are a content summariser for a social media ad creation tool.
Given the full text of a blog article or news post, write a clear, concise summary of 2-3 short paragraphs that captures:
1. The main topic and key points of the article
2. Any interesting facts, statistics, or insights mentioned
3. Why this content is relevant or interesting to a business audience

Write in plain English, third-person perspective. Be factual and informative.
Do NOT write ad copy — just summarise the article content accurately.
Keep the total summary under 400 words."""

    user_msg = f"Article title: {title}\n\nArticle content:\n{article_text}"

    try:
        ai_resp = _httpx.post(
            CHAT_URL,
            headers={
                "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "anthropic/claude-sonnet-4-5",
                "max_tokens": 600,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
            },
            timeout=45,
        )
        ai_resp.raise_for_status()
    except Exception as exc:
        raise HTTPException(502, f"AI summarisation error: {exc}")

    summary_text = (
        (ai_resp.json().get("choices") or [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )

    if not summary_text:
        raise HTTPException(500, "AI returned an empty summary — please try again.")

    # ── Build the copy directions string ──────────────────────────────
    # Return just the summary — the frontend appends the explicit URL
    # instruction separately so the LLM treats it as a hard requirement.
    return {
        "summary": summary_text,
        "title": title,
        "url": url,
    }
