import uuid
from datetime import datetime

from sqlalchemy import (
    JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def uid():
    return uuid.uuid4()


class Company(Base):
    __tablename__ = "companies"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="active")
    strikes: Mapped[int] = mapped_column(Integer, default=0)
    require_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    users: Mapped[list["User"]] = relationship(back_populates="company")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("email"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"))
    email: Mapped[str] = mapped_column(String(255), index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)  # NULL until an invited user accepts and sets one
    full_name: Mapped[str] = mapped_column(String(200), default="")
    role: Mapped[str] = mapped_column(String(20), default="admin")  # "admin" | "editor" | "poster"
    status: Mapped[str] = mapped_column(String(20), default="active")  # "active" | "invited" | "disabled"
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    invite_token: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True, unique=True)
    invited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    company: Mapped["Company"] = relationship(back_populates="users")


class DeveloperTeamUser(Base):
    """Platform-operator team accounts — entirely separate from the
    per-company User table above. The actual "owner" developer login
    (DEVELOPER_EMAIL/DEVELOPER_PASSWORD in .env) is NOT a row here and
    always has every permission implicitly; this table is only for
    additional team members the owner explicitly invites from
    Developer > Team, each with their own password and a configurable
    set of section permissions (see services/developer_team.py)."""
    __tablename__ = "developer_team_users"
    __table_args__ = (UniqueConstraint("email"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(255), index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(200), default="")
    permissions: Mapped[dict] = mapped_column(JSON, default=dict)  # {"models": true, "themes": false, ...} — see PERMISSION_KEYS
    status: Mapped[str] = mapped_column(String(20), default="active")  # "active" | "disabled"
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Subscription(Base):
    __tablename__ = "subscriptions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    tier: Mapped[str] = mapped_column(String(20), default="free")
    term_months: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="active")
    monthly_credits: Mapped[int] = mapped_column(Integer, default=3)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CreditLedger(Base):
    __tablename__ = "credit_ledger"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(50))
    ref_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class BrandVideoShot(Base):
    """One AI-generated intro (Start) or outro (Credit/End) clip in a
    company's gallery — up to 3 of each kind (enforced in
    routers/brand_kit.py). Generation runs as a Celery job exactly like
    ad video generation (see tasks.generate_brand_video_shot) since even
    a short 2-5s clip can take a while on a video model; `status` lets
    the gallery show a "generating" card with a spinner until `url` is
    populated. Selected per-ad in Create Ad's AI Video section (stored
    as start_shot_id/end_shot_id on that ad's brief, not here) and
    stitched onto the generated video via ffmpeg concat — see
    services/reframe.py concat_video and tasks.py's video pipeline."""
    __tablename__ = "brand_video_shots"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    kind: Mapped[str] = mapped_column(String(10))  # "intro" | "outro"
    status: Mapped[str] = mapped_column(String(20), default="queued")  # "queued" | "running" | "ready" | "failed"
    label: Mapped[str] = mapped_column(String(120), default="")  # user-editable display name — falls back to a truncated prompt in the UI when blank, never auto-derived from the prompt server-side so renaming never fights with regenerating the description
    prompt: Mapped[str] = mapped_column(Text, default="")
    duration: Mapped[int] = mapped_column(Integer, default=3)
    ratio: Mapped[str] = mapped_column(String(10), default="16:9")  # one of the company's available video ratios (see services/video_ratios.py) — the raw AI generation is reframed to this via reframe_video before it's finalized, same padding pipeline used everywhere else
    mute_audio: Mapped[bool] = mapped_column(Boolean, default=False)  # generate without audio: audio=False is sent to the model (skips audio for models that honor it) AND any audio track that still comes back is stripped via ffmpeg before saving — see reframe.strip_audio
    model_used: Mapped[str | None] = mapped_column(String(120), nullable=True)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    poster_url: Mapped[str | None] = mapped_column(String(500), nullable=True)  # last frame as a static JPEG — used for the gallery card thumbnail so the clip doesn't autoplay in a tiny window; full playback happens in the Preview modal instead
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Optional generation inputs — all nullable/blank means "plain
    # text-to-video, no logo reference, no burned-in text", exactly the
    # original behaviour. See routers/brand_kit.py + tasks.py.
    reference_logo_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)  # a BrandLogo id — its url is sent to the video model as the starting frame, so the AI generates around/animates that actual logo rather than guessing at one from the text prompt alone
    overlay_text: Mapped[str | None] = mapped_column(Text, nullable=True)  # e.g. contact info / website — burned in via ffmpeg drawtext AFTER generation (see reframe.add_text_overlay), never left to the AI to render, since video models are unreliable at exact legible text
    overlay_font: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "sans" | "sans_bold" | "serif" — see reframe.FONT_PATHS
    overlay_font_size: Mapped[str | None] = mapped_column(String(10), nullable=True)  # "small" | "medium" | "large" — see reframe.FONT_SIZE_FACTORS
    overlay_text_color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    overlay_position: Mapped[str | None] = mapped_column(String(20), nullable=True)  # one of 9 anchors (8 edges/corners + middle_center for text-only shots) — see reframe.add_text_overlay's ANCHOR_EXPRESSIONS


class BrandLogo(Base):
    """One uploaded logo in a company's gallery (up to 5, enforced in
    routers/brand_kit.py). BrandKit.logo_url is the ACTIVE one — the
    single URL every ad-generation/composite consumer already reads
    (routers/ads.py, campaigns.py, app.index.tsx) — deliberately kept
    as-is so "activating" a gallery logo is just copying its url onto
    that one existing field, with zero changes needed anywhere logos
    actually get used."""
    __tablename__ = "brand_logos"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    url: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class BrandKit(Base):
    __tablename__ = "brand_kits"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    primary_color: Mapped[str] = mapped_column(String(9), default="#7c3aed")
    tagline: Mapped[str] = mapped_column(String(200), default="")
    logo_placement: Mapped[str] = mapped_column(String(20), default="bottom-right")
    # Reframe/padding — used when a generated video or image's native
    # aspect ratio doesn't match a platform's required ratio (see
    # services/reframe.py). Video and image each get their own
    # independent settings (companies often want different fills for
    # each — e.g. a blurred background for video but branded bar images
    # for static posts) — the vertical_/horizontal_ fields below are
    # VIDEO-only; the image_ prefixed fields are their exact image
    # counterparts. Within each media type, still two independent
    # directions: vertical padding (top/bottom bars, needed when the
    # source is WIDER than the target) and horizontal padding
    # (left/right bars, needed when the source is TALLER than the
    # target). Mode is "blurred_video" | "image" | "color" — image URLs
    # and colors are only read when that direction's mode selects them.
    vertical_pad_mode: Mapped[str] = mapped_column(String(20), default="blurred_video")
    horizontal_pad_mode: Mapped[str] = mapped_column(String(20), default="blurred_video")
    pad_top_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    pad_bottom_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    pad_left_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    pad_right_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    vertical_pad_color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    horizontal_pad_color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    image_vertical_pad_mode: Mapped[str] = mapped_column(String(20), default="blurred_video")
    image_horizontal_pad_mode: Mapped[str] = mapped_column(String(20), default="blurred_video")
    image_pad_top_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    image_pad_bottom_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    image_pad_left_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    image_pad_right_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    image_vertical_pad_color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    image_horizontal_pad_color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    # {"platform_id": "ratio"} — a company's own override of the
    # developer's platform-wide default ratio (see
    # services/platform_config.py's DEFAULT_PLATFORMS / video_ratio
    # field). Only platforms this company has explicitly overridden
    # appear here; anything absent falls back to the developer default.
    platform_ratio_overrides: Mapped[dict] = mapped_column(JSON, default=dict)


class Product(Base):
    __tablename__ = "products"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    audience: Mapped[str] = mapped_column(String(300), default="")
    offer: Mapped[str] = mapped_column(String(300), default="")
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Ad(Base):
    __tablename__ = "ads"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("products.id"), nullable=True, index=True)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("campaigns.id"), nullable=True, index=True)
    campaign_phase: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "teaser" | "launch" | "followup"
    brief: Mapped[dict] = mapped_column(JSON, default=dict)
    platforms: Mapped[list] = mapped_column(JSON, default=list)
    outputs: Mapped[dict] = mapped_column(JSON, default=dict)
    results: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    posted_platforms: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    agent_source: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "quick_start" | "event" | None (normal, human-created) — drives the "Agent Niva" tag in My Ads/Calendar
    agent_event_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agent_events.id"), nullable=True)  # only set when agent_source == "event" — which recurring event definition produced this ad


class GenerationJob(Base):
    __tablename__ = "generation_jobs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    ad_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ads.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="ad")
    status: Mapped[str] = mapped_column(String(20), default="queued")
    credits_cost: Mapped[int] = mapped_column(Integer, default=1)
    model_used: Mapped[str | None] = mapped_column(String(120), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Campaign(Base):
    __tablename__ = "campaigns"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    brief: Mapped[str] = mapped_column(Text, default="")
    phases: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ScheduledPost(Base):
    __tablename__ = "scheduled_posts"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    ad_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ads.id"), index=True)
    platform: Mapped[str] = mapped_column(String(20))
    scheduled_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending|review_required|posted|canceled|failed
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PlatformConnection(Base):
    __tablename__ = "platform_connections"
    __table_args__ = (UniqueConstraint("company_id", "platform"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    platform: Mapped[str] = mapped_column(String(20))
    encrypted_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="connected")
    connected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class GuardrailRule(Base):
    __tablename__ = "guardrail_rules"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id"), nullable=True, index=True)
    phrase: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FlaggedContent(Base):
    __tablename__ = "flagged_content"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    text: Mapped[str] = mapped_column(Text)
    matched_term: Mapped[str] = mapped_column(String(200))
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id"), nullable=True, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(60), index=True)
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ModelConfig(Base):
    """Legacy global singleton - no longer read anywhere in the app.
    Kept in place (not dropped) to avoid a destructive migration;
    CompanyModelConfig below is what's actually used now."""
    __tablename__ = "model_config"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    config: Mapped[dict] = mapped_column(JSON, default=dict)


class CompanyModelConfig(Base):
    """Per-company choice of which AI model TIER (low/medium/best) to use
    for image and video generation — lets each company trade off cost vs
    quality for their own generations. One row per company; falls back
    to DEFAULT_MODEL_CFG (services/credits.py) if never customized."""
    __tablename__ = "company_model_config"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), unique=True)
    config: Mapped[dict] = mapped_column(JSON, default=dict)


class CompanyAgentSettings(Base):
    """Per-company Agent Niva policy — Quick Start mode, event approval
    mode, and credit-spend cap. One row per company; falls back to
    DEFAULT_AGENT_SETTINGS (services/agent_settings.py) if the company
    has never customised it. Mirrors CompanyModelConfig's shape exactly:
    unique company_id FK + JSON config column."""
    __tablename__ = "company_agent_settings"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), unique=True)
    config: Mapped[dict] = mapped_column(JSON, default=dict)


class Notification(Base):
    """In-app notification for a company user — created by the Celery
    beat task when Agent Niva generates or schedules an event ad.
    company_id scoped so all admins of a company see the same pool;
    dismissed_by is a JSON list of user_ids who've dismissed it so
    one admin dismissing doesn't hide it from others."""
    __tablename__ = "notifications"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    type: Mapped[str] = mapped_column(String(40))  # "agent_draft_ready" | "agent_review_required" | "agent_auto_posting_soon" | "agent_posted"
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    action_url: Mapped[str | None] = mapped_column(String(500), nullable=True)  # e.g. "/app/calendar" or "/app/my-ads"
    dismissed_by: Mapped[list] = mapped_column(JSON, default=list)  # list of user_id strings who dismissed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RoleCapability(Base):
    """Per-company configuration of what the 'editor' and 'poster' roles
    can do — admin always has every capability implicitly (not stored,
    not configurable). One row per company; falls back to sensible
    defaults (see services/capabilities.py) if a company has never
    customized this."""
    __tablename__ = "role_capabilities"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), unique=True)
    config: Mapped[dict] = mapped_column(JSON, default=dict)  # {"editor": {cap: bool, ...}, "poster": {...}}


class AgentEvent(Base):
    """A recurring yearly occasion (Christmas, a seasonal sale, etc) that
    Agent Niva watches for — see tasks.check_agent_events, a daily Celery
    Beat job. Every year, `lead_days` before month/day, it generates an
    ad and (depending on the developer's configured
    agent_settings.event_approval_mode) drafts it, schedules it for
    review, or posts it automatically. `skipped_years` lets a specific
    occurrence be turned off (e.g. "not running the Christmas ad this
    year") without deleting the whole recurring definition — `enabled`
    is the permanent on/off switch, skipped_years is a one-off pause."""
    __tablename__ = "agent_events"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))  # e.g. "Christmas"
    month: Mapped[int] = mapped_column(Integer)  # 1-12
    day: Mapped[int] = mapped_column(Integer)  # 1-31 (validated against the month at creation time)
    lead_days: Mapped[int] = mapped_column(Integer, default=2)  # generate this many days BEFORE month/day
    guidance: Mapped[str] = mapped_column(Text, default="")  # freeform brief for what the ad should be about, e.g. "20% off holiday sale, festive theme"
    platforms: Mapped[list] = mapped_column(JSON, default=list)
    product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    approval_mode: Mapped[str] = mapped_column(String(30), default="draft_only")  # "draft_only" | "schedule_review" | "auto_post"
    skipped_years: Mapped[list] = mapped_column(JSON, default=list)
    draft_run_year: Mapped[int | None] = mapped_column(Integer, nullable=True)  # year the draft was created (Trigger 1)
    last_run_year: Mapped[int | None] = mapped_column(Integer, nullable=True)   # year the post was generated (Trigger 2) — kept for back-compat
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AgentRecommendation(Base):
    """One AI-suggested ad idea from Quick Start's "study my website and
    recommend ads" flow (see routers/agent.py, tasks.generate_quick_start_recommendations).
    Stays "pending" for the customer to review/edit and turn into a real
    ad (or dismiss) — see agent_settings.quick_start_mode for whether
    that review step is required or skipped."""
    __tablename__ = "agent_recommendations"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    source_url: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # "pending" | "created" | "dismissed"
    title: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    audience: Mapped[str] = mapped_column(String(300), default="")  # suggested target audience, pre-fills Create Ad's audience field
    platforms: Mapped[list] = mapped_column(JSON, default=list)
    created_ad_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ads.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AgentScrapeJob(Base):
    """Tracks one Quick Start run (scrape a URL -> N recommendations) as
    a background job, same async job/polling pattern as ad generation —
    scraping + AI recommendation can take a little while, so the
    frontend polls this instead of blocking on one request."""
    __tablename__ = "agent_scrape_jobs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    url: Mapped[str] = mapped_column(String(500))
    count: Mapped[int] = mapped_column(Integer, default=5)
    focus: Mapped[str | None] = mapped_column(String(500), nullable=True)  # optional subject/topic the customer wants to focus on
    status: Mapped[str] = mapped_column(String(20), default="queued")  # "queued" | "running" | "ready" | "failed"
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
