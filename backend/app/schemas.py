import uuid
from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterIn(BaseModel):
    company_name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = ""
    accept_aup: bool


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UpdateProfileIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str
    role: str
    status: str
    email_verified: bool

    class Config:
        from_attributes = True


# ---------- Team / users ----------

VALID_ROLES = ("admin", "editor", "poster")


class InviteUserIn(BaseModel):
    email: EmailStr
    full_name: str = ""
    role: str = Field(pattern="^(admin|editor|poster)$")


class UpdateUserIn(BaseModel):
    role: str | None = Field(default=None, pattern="^(admin|editor|poster)$")
    status: str | None = Field(default=None, pattern="^(active|disabled)$")


class AcceptInviteIn(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = None  # lets the invitee correct/fill in their name if left blank


class TeamUserOut(BaseModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str
    role: str
    status: str
    invited_at: datetime | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class InviteCheckOut(BaseModel):
    """Used by the public accept-invite page to show who/what the invite
    is for, before the person sets a password."""
    email: EmailStr
    full_name: str
    company_name: str
    inviter_name: str


class RoleCapabilitiesOut(BaseModel):
    editor: dict[str, bool]
    poster: dict[str, bool]


class RoleCapabilitiesIn(BaseModel):
    editor: dict[str, bool]
    poster: dict[str, bool]


class AdminOverviewOut(BaseModel):
    """Real, company-scoped stats only — never platform-wide numbers.
    A company's admin should never see other companies' data, even
    aggregated."""
    tier: str
    credits_remaining: int
    credits_used_this_month: int
    team_members: int
    ads_created_total: int
    ads_created_this_month: int
    campaigns_total: int
    scheduled_pending: int
    flagged_unresolved: int


class DayCountOut(BaseModel):
    date: str  # "YYYY-MM-DD"
    count: int


class AnalyticsOut(BaseModel):
    """Real, company-scoped activity data — deliberately does NOT include
    reach/clicks/engagement, since those require actually posting to a
    real platform (still MOCK_POSTING), and showing fake numbers there
    would be actively misleading rather than just incomplete. Available
    to any role with the view_analytics capability, not just admins —
    so nothing here should be as sensitive as e.g. flagged-content
    details (that stays admin-only, in Moderation)."""
    ads_created_total: int
    ads_created_this_month: int
    credits_used_this_month: int
    scheduled_pending: int
    campaigns_total: int
    ads_by_day: list[DayCountOut]  # last 30 days, zero-filled for days with no activity
    platform_breakdown: dict[str, int]  # ad counts per platform — an ad targeting 2 platforms counts once for each
    status_breakdown: dict[str, int]  # "created" | "scheduled" | "posted" — matches My Ads' own filter categories exactly


class AvailableModelOut(BaseModel):
    """One selectable option in Create Ad's model dropdown — deliberately
    has NO model slug field at all (not just stripped at the endpoint
    level like the old tier system did) — company users were never
    meant to see which AI model powers a choice, only its label/cost/
    duration, so the shape itself enforces that rather than relying on
    every call site to remember to strip it. Never includes the
    "pricing" formula either, for the same reason — see POST
    /ads/preview-cost for how the frontend gets a live, accurate credit
    total without the raw $ structure ever reaching the browser."""
    id: str
    label: str
    credits: int  # a representative/reference number — for models with dynamic pricing this is the cost of a common combination, not necessarily what any specific selection will actually cost; always call /ads/preview-cost for the real total
    min_duration: int | None = None  # video only — ignored if duration_options is set
    max_duration: int | None = None  # video only — ignored if duration_options is set
    duration_options: list[int] | None = None  # video only — set means DISCRETE choices only (e.g. [4, 6, 8]); Create Ad shows a picker instead of a free-entry duration field
    resolutions: list[str] | None = None  # video only — lets the customer pick a resolution in Create Ad; real cost differs by resolution once dynamic pricing is set on this model
    supports_audio: bool = False  # video only — whether to show an audio on/off toggle at all; only meaningful for models with dynamic pricing that actually vary by audio
    supports_last_frame: bool = False  # video only — whether this model accepts a separate end frame, enabling the "start + end frame" mode in Create Ad's video section
    has_dynamic_pricing: bool = False  # true if this model's cost genuinely varies by the customer's resolution/audio/duration choice; false means `credits` above is the fixed cost regardless of selection


class AvailableModelsOut(BaseModel):
    text: list[AvailableModelOut]
    image: list[AvailableModelOut]
    video: list[AvailableModelOut]


class PreviewCostIn(BaseModel):
    kind: str = Field(pattern="^(text|image|video)$")
    model_id: str
    resolution: str | None = None
    audio: bool = False
    duration_seconds: int | None = None  # required for video, ignored for image
    has_reference_image: bool = False  # video only — whether a reference/frame image is currently attached; affects price for models with a mode-based rate split or a per-input reference cost (see services/pricing.py)


class PreviewCostOut(BaseModel):
    credits: int


class MarkupMultiplierOut(BaseModel):
    markup_multiplier: float


class MarkupMultiplierIn(BaseModel):
    markup_multiplier: float = Field(ge=1.0, le=10.0)


class MaxExtraUsersOut(BaseModel):
    max_extra_users: int


class MaxExtraUsersIn(BaseModel):
    max_extra_users: int = Field(ge=0, le=1000)


class TeamLimitOut(BaseModel):
    """Company-facing view of the team size limit — used to show 'X of
    Y used' and disable the invite form proactively before it fails."""
    max_extra_users: int
    current_extra_users: int


class RetentionMonthsOut(BaseModel):
    retention_months: int


class RetentionMonthsIn(BaseModel):
    retention_months: int = Field(ge=1, le=120)


class PostRetentionMonthsOut(BaseModel):
    post_retention_months: int


class PostRetentionMonthsIn(BaseModel):
    post_retention_months: int = Field(ge=1, le=240)  # up to 20 years — media retention caps lower (120 = 10 years) since posts genuinely need to outlive their media by design


class RetentionInfoOut(BaseModel):
    """Company-facing combined view — both numbers together, since the
    generation-time notice and My Ads warning both need to mention
    media AND post retention in one message."""
    retention_months: int
    post_retention_months: int


class VideoPrepSettingsOut(BaseModel):
    """Developer-managed models for two background video-quality steps
    (see services/video_prep.py) — neither ever exposed to a company
    user, both optional (null = that step is skipped entirely)."""
    prompt_review_model_id: str | None = None
    image_model_id: str | None = None


class VideoPrepSettingsIn(BaseModel):
    prompt_review_model_id: str | None = None
    image_model_id: str | None = None


class RawModelsOut(BaseModel):
    """The full text/image/video model list, unvalidated shape (each
    entry is whatever's actually stored) — for display in the bulk-edit
    JSON view. Not DeveloperModelsOut, deliberately: that would silently
    drop any field not in the schema, which defeats the point of a raw
    view meant to show and let you edit EXACTLY what's stored."""
    models: dict


class RawModelsIn(BaseModel):
    models: dict


class RawThemesOut(BaseModel):
    """Create Ad's Text Theme Reference chips + Image Theme Reference
    gallery, unvalidated shape — same bulk-JSON-edit pattern as
    RawModelsOut/RawModelsIn above."""
    themes: dict


class RawThemesIn(BaseModel):
    themes: dict


class ThemeThumbnailUploadIn(BaseModel):
    image: str  # base64 data URL


class ThemeThumbnailUploadOut(BaseModel):
    url: str


class VideoThemeShotOut(BaseModel):
    label: str
    duration: int
    prompt_template: str


class VideoThemeOut(BaseModel):
    id: str
    label: str
    thumbnail: str | None = None
    category_tags: list[str]
    style_notes: str
    shots: list[VideoThemeShotOut]


class VideoThemeShotIn(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    duration: int = Field(ge=1, le=30)
    prompt_template: str = Field(min_length=1, max_length=1200)


class SaveVideoThemeIn(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=80)
    thumbnail: str | None = None
    category_tags: list[str] = []
    style_notes: str = Field(default="", max_length=500)
    shots: list[VideoThemeShotIn] = Field(min_length=1)


class GenerateVideoThemeDraftIn(BaseModel):
    brief: str = Field(min_length=1, max_length=400)
    category_tags: list[str] = []


class GenerateVideoThemeDraftOut(BaseModel):
    label: str
    style_notes: str
    shots: list[VideoThemeShotOut]


class GenerateVideoThemeThumbnailIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=1200)


class GenerateVideoThemeThumbnailOut(BaseModel):
    url: str


class ImageThemeEditorOut(BaseModel):
    """Developer > Themes > Image Theme tab — fully visual, no JSON shown.
    Every style tag and every product-category tag gets its own editable
    prompt (and, for the image-reference variant, its own thumbnail)."""
    style_tags: list[str]
    category_tags: list[str]
    text_for_image: dict  # {"style": {tag: prompt_str}, "product": {tag: prompt_str}}
    image_for_image: dict  # {"style": {tag: {"thumbnail": url, "prompt": str}}, "product": {...}}


class ImageThemeEditorIn(BaseModel):
    text_for_image: dict
    image_for_image: dict


class AddThemeTagIn(BaseModel):
    axis: str  # "style" | "category"
    tag: str = Field(min_length=1, max_length=60)


class ThemeAiVisionModelOut(BaseModel):
    id: str
    label: str
    model: str


class ThemeAiSettingsOut(BaseModel):
    text_model_id: str | None
    vision_model_id: str | None
    image_transform_model_id: str | None
    vision_models: list[ThemeAiVisionModelOut]


class ThemeAiSettingsIn(BaseModel):
    text_model_id: str | None = None
    vision_model_id: str | None = None
    image_transform_model_id: str | None = None


class AddVisionModelIn(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=200)


class GenerateTagPromptIn(BaseModel):
    axis: str  # "style" | "category"
    tag: str


class GenerateTagPromptOut(BaseModel):
    prompt: str


class AnalyzeThemeImageIn(BaseModel):
    image: str  # base64 data URL


class AnalyzeThemeImageOut(BaseModel):
    matched_style_tags: list[str]
    matched_category_tags: list[str]
    new_style_tag: str | None
    new_category_tag: str | None
    prompt: str
    thumbnail_url: str


class ImageGalleryEntryIn(BaseModel):
    id: str
    label: str
    thumbnail: str
    style_tags: list[str] = []
    category_tags: list[str] = []
    base_prompt: str


class GenerateAllMissingOut(BaseModel):
    editor: ImageThemeEditorOut
    filled: int
    skipped: int


class TextThemeSelectionOut(BaseModel):
    """Company-facing (Create Ad) equivalent of the Text for Image editor
    — same style/product prompt maps, read-only."""
    style_tags: list[str]
    category_tags: list[str]
    style_prompts: dict
    category_prompts: dict


class AssistantHintOut(BaseModel):
    id: str
    key: str
    label: str
    message: str
    audio_url: str | None = None



class AssistantSettingsOut(BaseModel):
    assistant_name: str = "Nova"
    typing_ms_per_char: int
    tts_voice: str
    tts_model: str
    intro_audio_url: str | None = None
    intro_text: str | None = None


class AssistantSettingsIn(BaseModel):
    assistant_name: str = Field(default="Nova", min_length=1, max_length=40)
    typing_ms_per_char: int = Field(ge=8, le=120)
    tts_voice: str = "nova"
    tts_model: str = "openai/gpt-audio-mini"


class GenerateIntroAudioIn(BaseModel):
    text: str = Field(min_length=1, max_length=600)


class AddAssistantHintIn(BaseModel):
    key: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=600)


class UpdateAssistantHintIn(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=600)


class TextStylePresetOut(BaseModel):
    id: str
    label: str
    font_style: str
    text_color: str
    accent_color: str
    size: str


class AddTextStylePresetIn(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    font_style: str = ""
    text_color: str = ""
    accent_color: str = ""
    size: str = ""


class UpdateTextStylePresetIn(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    font_style: str = ""
    text_color: str = ""
    accent_color: str = ""
    size: str = ""


# ---------- Developer (platform operator) — fully separate from the
# per-company user/admin system above; never references a User or
# Company row ----------

class DeveloperLoginIn(BaseModel):
    email: str
    password: str


class DeveloperTokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    is_owner: bool = True
    permissions: dict[str, bool] = {}


class DeveloperTeamUserOut(BaseModel):
    id: str
    email: str
    full_name: str
    permissions: dict[str, bool]
    status: str
    created_at: datetime


class AddDeveloperTeamUserIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    full_name: str = Field(default="", max_length=200)
    password: str = Field(min_length=8, max_length=100)
    permissions: dict[str, bool] = {}


class UpdateDeveloperTeamUserIn(BaseModel):
    full_name: str | None = Field(default=None, max_length=200)
    permissions: dict[str, bool] | None = None
    status: str | None = None
    password: str | None = Field(default=None, min_length=8, max_length=100)


class CompanyAdminOut(BaseModel):
    """One row in the developer's company list — deliberately does not
    include anything about the company's own ad/campaign CONTENT, only
    account/billing-shape facts a platform operator legitimately needs."""
    id: uuid.UUID
    name: str
    tier: str
    subscription_status: str
    cancel_at_period_end: bool
    credits_balance: int
    user_count: int
    ads_total: int
    created_at: datetime


class PlatformConnectionOut(BaseModel):
    platform: str
    status: str  # "connected" | "not_connected" | "broken" (decrypt/refresh failure)
    connected_at: datetime | None = None


class PlatformOverviewOut(BaseModel):
    total_companies: int
    companies_by_tier: dict[str, int]
    active_paid_subscriptions: int
    estimated_mrr_usd: float  # rounded estimate from each company's TIER base price — not exact Stripe-reported revenue (term discounts aren't factored in)
    total_users: int
    total_ads: int
    total_campaigns: int
    flagged_unresolved_total: int


class OpenRouterCreditsOut(BaseModel):
    """Your actual OpenRouter account balance — the same account every
    company's image/video generation draws from. A separate endpoint
    from the rest of the platform overview (not folded into it) since
    this is a live external API call to OpenRouter itself, and
    shouldn't be able to break the rest of the Overview page if
    OpenRouter is slow or briefly unreachable."""
    total_credits: float
    total_usage: float
    remaining: float


class DeveloperModelOut(BaseModel):
    """The developer's own view of one model entry — WITH the real model
    slug, unlike AvailableModelOut. This is the only place a model slug
    is ever exposed to the frontend."""
    id: str
    label: str
    model: str
    credits: int  # LEGACY flat cost — still used as a fallback whenever "pricing" is absent, and shown as a reference number even when it isn't the live source of truth
    min_duration: int | None = None
    max_duration: int | None = None
    duration_options: list[int] | None = None  # video only — DISCRETE allowed durations (e.g. [5, 10] for Kling O1, [4, 6, 8] for the Veo family) — when set, this replaces the min/max range entirely; Create Ad shows a picker instead of a free slider
    resolutions: list[str] | None = None  # video only — which resolutions this entry offers (e.g. ["480p","720p","1080p"]); provider cost differs per resolution, so exposing the choice lets ads be generated cheaper at lower res
    supports_audio: bool = False  # video only — whether this model can generate with/without audio at all, INDEPENDENT of whether dynamic pricing is configured (a model can support audio before the developer has gotten around to setting up its full pricing formula)
    supports_last_frame: bool = False  # video only — whether this model accepts a SEPARATE end frame (frame_type: "last_frame") in addition to the starting frame, for a "move from composition A to composition B" video instead of just animating freely from one image
    price_per_second_usd: float | None = None  # video only — the provider's own per-second cost, shown for the developer's reference when setting credits; informational only for now (token-to-cost mapping deliberately deferred)
    enabled: bool = True  # disabled entries stay configured (editable, re-enableable) but are hidden from Create Ad's dropdown — different from deleting, which discards the entry entirely
    pricing: dict | None = None  # opts this model into DYNAMIC per-combination pricing (see services/pricing.py). Video shape: {"rates_usd_per_second": {"720p": {"audio": 0.10, "no_audio": 0.08}, ...}, "supports_audio": true}. Image shape: {"cost_usd": 0.03}. Absent = falls back to the flat "credits" value above, unchanged from before this feature existed.


class DeveloperModelsOut(BaseModel):
    text: list[DeveloperModelOut]
    image: list[DeveloperModelOut]
    video: list[DeveloperModelOut]


class AddModelIn(BaseModel):
    """Developer-only — adds a new model to the open-ended list for a
    kind (no fixed count anymore, replacing the old low/medium/best/
    super tier system — add as many as you want)."""
    kind: str = Field(pattern="^(text|image|video)$")
    label: str = Field(min_length=1, max_length=60)
    model: str = Field(min_length=1, max_length=200)
    credits: int = Field(ge=1, le=50)
    min_duration: int | None = Field(default=None, ge=1, le=60)  # video only; ignored for image
    max_duration: int | None = Field(default=None, ge=1, le=60)  # video only; ignored for image
    duration_options: list[int] | None = None  # video only — set for models with fixed/discrete durations only (not a range)
    resolutions: list[str] | None = None  # video only; e.g. ["480p","720p"] — which of the provider's supported resolutions to offer in Create Ad
    supports_audio: bool = False  # video only — whether this model can generate with/without audio at all
    supports_last_frame: bool = False  # video only — whether this model accepts a separate end frame alongside the starting frame
    price_per_second_usd: float | None = Field(default=None, ge=0)  # video only; informational (from OpenRouter's catalog)
    pricing: dict | None = None  # see DeveloperModelOut.pricing — omit to keep this model on flat legacy credits


class UpdateModelIn(BaseModel):
    """Developer-only — edits an existing model entry by id. All fields
    optional except what's actually changing; omitted fields keep their
    current value (a real bug in the old tier-edit endpoint used to wipe
    fields that weren't included — this mirrors the fix for that: only
    overwrite what's explicitly provided)."""
    label: str | None = Field(default=None, min_length=1, max_length=60)
    model: str | None = Field(default=None, min_length=1, max_length=200)
    credits: int | None = Field(default=None, ge=1, le=50)
    min_duration: int | None = Field(default=None, ge=1, le=60)
    max_duration: int | None = Field(default=None, ge=1, le=60)
    duration_options: list[int] | None = None
    resolutions: list[str] | None = None
    supports_audio: bool | None = None
    supports_last_frame: bool | None = None
    price_per_second_usd: float | None = Field(default=None, ge=0)
    enabled: bool | None = None
    pricing: dict | None = None


class ReorderModelsIn(BaseModel):
    """Developer-only — sets the display order for a kind's model list
    (both here and in Create Ad's dropdown, which shows them in this
    exact order) by supplying every current id in the desired sequence."""
    kind: str = Field(pattern="^(text|image|video)$")
    ordered_ids: list[str] = Field(min_length=1)


class PlatformIntegrationOut(BaseModel):
    """Developer's own view of one platform's posting credentials —
    client_secret is NEVER returned, even to the developer, once saved
    (masked as a fixed placeholder so the UI can show "a secret is set"
    without ever re-exposing the real value over the wire again)."""
    id: str
    label: str
    client_id: str
    has_secret: bool
    scope: str | None = None
    redirect_uri: str | None = None
    enabled: bool = True
    built: bool = False  # whether real integration code exists for this platform yet (currently only linkedin) — informational, so the developer isn't surprised nothing happens when they enable an unbuilt one
    video_ratio: str = "1:1"  # the aspect ratio the reframe pipeline treats as this platform's required format — set here, alongside everything else about the platform, so adding a platform and setting its ratio happen in one place


class AddPlatformIntegrationIn(BaseModel):
    id: str = Field(pattern="^[a-z0-9_-]{2,30}$")
    label: str = Field(min_length=1, max_length=60)
    client_id: str = Field(min_length=1, max_length=300)
    client_secret: str = Field(min_length=1, max_length=500)
    scope: str | None = None
    redirect_uri: str | None = None
    video_ratio: str = "1:1"  # validated against the developer's current ratio list at the endpoint, not a fixed pattern here — see services/video_ratios.py


class UpdatePlatformIntegrationIn(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=60)
    client_id: str | None = Field(default=None, min_length=1, max_length=300)
    client_secret: str | None = Field(default=None, min_length=1, max_length=500)  # omit to keep the current secret unchanged
    scope: str | None = None
    redirect_uri: str | None = None
    enabled: bool | None = None
    video_ratio: str | None = None  # validated against the developer's current ratio list at the endpoint


class CompanyPlatformOut(BaseModel):
    """What a company admin sees — deliberately just enough to show a
    Connect button and status. No client_id, no secret, ever."""
    id: str
    label: str
    built: bool = False  # whether real integration code exists yet (currently only linkedin) — lets the UI show "Coming soon" honestly instead of a Connect button that would just 404
    video_ratio: str = "1:1"  # informational — the aspect ratio a post to this platform will be sized to; read-only here, only the developer can change it


class OpenRouterCatalogModelOut(BaseModel):
    """One model from OpenRouter's own live catalog — what the developer
    browses in the 'Fetch from OpenRouter' popup before clicking Add.
    Everything here comes straight from OpenRouter's API, filtered to
    the requested kind."""
    slug: str
    name: str
    description: str | None = None
    price_per_second_usd: float | None = None  # video models — provider's per-second generation cost
    price_per_image_usd: float | None = None   # image models — provider's per-image cost
    resolutions: list[str] | None = None       # supported output resolutions where the catalog exposes them
    max_duration: int | None = None            # documented max clip seconds where exposed


class MeOut(BaseModel):
    user: UserOut
    company_id: uuid.UUID
    company_name: str
    tier: str
    credits: int
    current_period_end: datetime | None = None
    cancel_at_period_end: bool = False
    capabilities: dict[str, bool] = Field(default_factory=dict)  # resolved for THIS user's role — admin gets everything True


# ---------- Ads / generation ----------

class VideoShotIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)
    duration: int = Field(ge=1, le=60)  # outer sanity bound only — REAL enforcement is against the company's active video tier's min_duration/max_duration, done in the endpoint (services/credits.py: DEFAULT_MODEL_CFG), not here


class CarouselSlideThemeIn(BaseModel):
    """Per-slide Text/Image Theme Reference override for one carousel
    slide — same shape as the ad-level env/image_scene/text_overlay,
    just scoped to a single slide. A field left None on a given slide
    falls back to that ad-level value instead of overriding it."""
    env: str | None = None
    image_scene: str | None = None
    text_overlay: str | None = None


class AdCreateIn(BaseModel):
    product_name: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=10, max_length=3000)
    audience: str = ""
    offer: str = ""
    goal: str = "Drive sales"
    tone: str = "Professional"
    env: str | None = None
    image_scene: str | None = None
    text_overlay: str | None = None  # positioned text (headline/badge/body etc.) from an Image Theme Reference pick — kept separate from env/image_scene so the prompt builder only renders it once
    product_image: str | None = None
    product_image_url: str | None = None
    tagline: str | None = None
    use_brand_logo: bool = False
    product_id: uuid.UUID | None = None
    platforms: list[str] = Field(min_length=1)
    outputs: dict = Field(default_factory=lambda: {"text": True, "image": True, "video": False})
    format: str = "single"
    variations: int = 1
    text_prompt_override: str | None = None
    image_prompt_override: str | None = None
    carousel_slides: list[str] | None = None  # per-slide image descriptions, in order — length determines carousel image count (server enforces CAROUSEL_MAX_IMAGES)
    carousel_theme: list[CarouselSlideThemeIn | None] | None = None  # per-slide Text/Image Theme Reference override — each slide can have its OWN env/image_scene/text_overlay instead of sharing the ad-level one; a null entry (or a shorter list) means that slide falls back to the shared theme above
    video_shots: list[VideoShotIn] | None = None  # one or more {prompt, duration} shots — if more than one, combined into a single timing-marked prompt sent as ONE generation call (server enforces MAX_VIDEO_SHOTS and validates the TOTAL duration against the company's active tier)
    video_prompt_override: str | None = None  # the confirmed/edited prompt from the preview popup — now applies for ANY shot count (not just single-shot), since preview always runs shot review (if configured) before showing it; when present, used directly at generation time instead of rebuilding from video_shots, so review + edits aren't silently redone or lost
    video_frame_image: str | None = None  # raw base64 data URL, freshly uploaded — a DEDICATED image for the video's starting frame, deliberately separate from product_image (used for image generation), so it's always unambiguous whether an image is actually being sent to the video API
    video_frame_image_url: str | None = None  # already-stored URL, e.g. reusing a previously uploaded photo
    video_end_frame_image: str | None = None  # raw base64 data URL — the video's ENDING frame, only meaningful when video_mode is "first_last_frame" and the selected model supports it (see AvailableModelOut.supports_last_frame)
    video_end_frame_image_url: str | None = None  # already-stored URL variant of the above
    video_mode: str = "single_reference"  # "single_reference" (default — animate from one starting image, or none for pure text-to-video) | "first_last_frame" (provide both a start and end composition; only valid for models where supports_last_frame is true)
    refine_video_prompt: bool = False  # opt-in — the developer-configured review model (if any) only runs when this is explicitly checked; off by default since the raw customer wording isn't always worse
    refine_video_frame: bool = False  # opt-in — ONLY meaningful in single_reference mode: whether to pre-render the reference photo's background to match shot 1's described scene (the video-prep fix). Never applies in first_last_frame mode — those two images are deliberately chosen compositions, not a photo to reinterpret; frame prep never runs there regardless of this flag.
    image_reference_image: str | None = None  # raw base64 data URL — a DEDICATED reference for IMAGE generation, set in Step 2's AI image section; when present it takes priority over the Step 1 product photo as the generation reference (same explicit-over-implicit principle as video's frame image)
    image_reference_image_url: str | None = None  # already-stored URL variant of the above
    image_model_id: str | None = None  # which entry from GET /ads/available-models the user picked in Step 2's dropdown — replaces the old company-wide "active tier" concept; required if outputs.image is true
    video_model_id: str | None = None  # same, for video; required if outputs.video is true
    text_model_id: str | None = None  # same, for text — text generation is no longer free/bundled; if outputs.text is true this is required, resolved to a real credit cost like image/video
    video_resolution: str | None = None  # which of the chosen video model's offered resolutions to generate at (validated against that model's own list); defaults server-side to the model's first offered resolution if omitted
    video_audio: bool = False  # whether to generate with native audio, for models that support the choice (see AvailableModelOut.supports_audio) — genuinely affects both the output AND the price for dynamically-priced models; ignored for models without an audio toggle
    video_start_shot_id: str | None = None  # a Brand Kit intro clip (see /brand-kit/video-shots, kind="intro") to prepend via ffmpeg concat — null/omitted means no intro, same as any other optional field here
    video_end_shot_id: str | None = None  # same, for a Brand Kit outro/credits clip (kind="outro") appended at the end


class RefineIn(BaseModel):
    feedback: str = Field(min_length=2, max_length=1000)
    variant: int = 0


class AdPatchIn(BaseModel):
    status: str | None = None
    favorite: bool | None = None
    results: dict | None = None


class PostAdIn(BaseModel):
    platforms: list[str] = Field(min_length=1)


class AdScheduledPostOut(BaseModel):
    """One platform's pending schedule for an ad — lets My Ads show and
    manage each platform's schedule individually (cancel one without
    affecting others), not just a single aggregated "next" time."""
    id: uuid.UUID
    platform: str
    scheduled_at: datetime


class AdOut(BaseModel):
    id: uuid.UUID
    status: str
    brief: dict
    platforms: list
    outputs: dict
    results: dict | None
    favorite: bool
    product_id: uuid.UUID | None = None
    campaign_id: uuid.UUID | None = None
    campaign_phase: str | None = None
    campaign_name: str | None = None
    posted_at: datetime | None = None
    posted_platforms: list = Field(default_factory=list)
    # FIXED 2026-07-12: this field was silently missing from AdOut
    # entirely — the backend logic that computed it, and the frontend
    # code that read it, were both correct, but Pydantic drops any
    # value passed to a model constructor that isn't a declared field,
    # so it was NEVER actually reaching the response despite everything
    # around it looking right. This is the real reason My Ads never
    # showed a scheduled time no matter how the display logic was fixed.
    next_scheduled_at: datetime | None = None
    scheduled_posts: list[AdScheduledPostOut] = Field(default_factory=list)  # every platform's pending schedule for this ad, not just the earliest
    created_at: datetime
    error: str | None = None
    agent_source: str | None = None

    class Config:
        from_attributes = True


class AdListOut(BaseModel):
    items: list[AdOut]
    total: int
    page: int
    page_size: int


class AdCreatedOut(BaseModel):
    ad_id: uuid.UUID
    job_id: uuid.UUID | None = None
    credits_cost: int


class PromptPreviewIn(BaseModel):
    product_name: str = ""
    description: str = ""
    audience: str = ""
    offer: str = ""
    goal: str = "Drive sales"
    tone: str = "Professional"
    env: str | None = None
    image_scene: str | None = None
    text_overlay: str | None = None  # see AdCreateIn.text_overlay
    has_photo: bool = False
    tagline: str | None = None
    platforms: list[str] = Field(min_length=1)
    outputs: dict = Field(default_factory=dict)
    format: str = "single"
    variations: int = 1
    carousel_slides: list[str] | None = None
    video_shots: list[VideoShotIn] | None = None
    refine_video_prompt: bool = False  # opt-in — mirrors AdCreateIn's field; the preview only runs shot review when this is checked, so the preview matches what generation would actually do


class PromptPreviewOut(BaseModel):
    text_prompt: str
    image_prompt: str | None
    video_prompt: str | None = None  # populated for any shot count now — runs through shot review (if configured) before being built, so it's genuinely what generation would use, not just a single-shot preview
    reviewed_shots: list[VideoShotIn] | None = None  # the per-shot prompts AFTER review (if a review model is configured) — lets the frontend update its own shot list to match what was actually reviewed, keeping Step 2 in sync with what's shown here



# ---------- Products ----------

class ProductCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    audience: str = ""
    offer: str = ""
    image: str | None = None


class ProductOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    audience: str
    offer: str
    image_url: str | None
    created_at: datetime

    class Config:
        from_attributes = True


# ---------- Brand kit ----------

class BrandVideoShotOut(BaseModel):
    id: str
    kind: str
    status: str
    label: str
    prompt: str
    duration: int
    ratio: str
    mute_audio: bool = False
    url: str | None
    poster_url: str | None = None
    error: str | None
    created_at: datetime
    reference_logo_id: str | None = None
    overlay_text: str | None = None
    overlay_font: str | None = None
    overlay_font_size: str | None = None
    overlay_text_color: str | None = None
    overlay_position: str | None = None

    class Config:
        from_attributes = True


class GenerateBrandVideoShotIn(BaseModel):
    kind: str = Field(pattern="^(intro|outro)$")
    label: str = Field(default="", max_length=120)  # optional — falls back to a truncated prompt in the UI when blank
    prompt: str = Field(min_length=1, max_length=1000)
    duration: int = Field(ge=2, le=5)
    ratio: str = "16:9"  # must be one of the company's available ratios (GET /connections/video-ratios) — validated server-side
    mute_audio: bool = False  # generate a silent clip: audio=False is sent to the model AND any audio that still comes back is stripped via ffmpeg before saving, so the stored file is guaranteed silent either way
    model_id: str
    reference_logo_id: str | None = None  # a Brand Logo (see /brand-kit/logos) to send as the video's starting frame — the AI generates around/animates this actual logo instead of guessing at one from words alone
    overlay_text: str | None = Field(default=None, max_length=200)  # e.g. contact info / website — burned in via ffmpeg AFTER generation, not left to the AI to render as text
    overlay_font: str = Field(default="sans", pattern="^(sans|sans_bold|serif)$")
    overlay_font_size: str = Field(default="medium", pattern="^(small|medium|large)$")  # see reframe.FONT_SIZE_FACTORS — the old fixed size read too large, so the customer picks now
    overlay_text_color: str = "#ffffff"
    # 9 anchors — 8 edge/corner + middle_center (for text-only shots with
    # no logo reference). When a logo IS referenced, steer away from
    # middle_center toward an edge/corner instead — the AI tends to
    # place a referenced logo somewhere in the middle of frame, and
    # there's no way to know its exact position in advance.
    overlay_position: str = Field(default="bottom_center", pattern="^(top_left|top_center|top_right|middle_left|middle_center|middle_right|bottom_left|bottom_center|bottom_right)$")


class UpdateBrandVideoShotIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)


class BrandLogoOut(BaseModel):
    id: str
    url: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class AddBrandLogoIn(BaseModel):
    logo: str = Field(min_length=1)  # base64 data URL


class BrandKitUpdateIn(BaseModel):
    logo: str | None = None
    primary_color: str | None = None
    tagline: str | None = None
    logo_placement: str | None = None
    # Video padding (existing fields — unchanged meaning, now explicitly
    # video-only since image gets its own independent set below).
    vertical_pad_mode: str | None = Field(default=None, pattern="^(blurred_video|image|color)$")
    horizontal_pad_mode: str | None = Field(default=None, pattern="^(blurred_video|image|color)$")
    pad_top_image: str | None = None  # raw base64 data URL, freshly uploaded
    pad_bottom_image: str | None = None
    pad_left_image: str | None = None
    pad_right_image: str | None = None
    vertical_pad_color: str | None = None
    horizontal_pad_color: str | None = None
    # Image padding — independent from video (see services/reframe.py).
    image_vertical_pad_mode: str | None = Field(default=None, pattern="^(blurred_video|image|color)$")
    image_horizontal_pad_mode: str | None = Field(default=None, pattern="^(blurred_video|image|color)$")
    image_pad_top_image: str | None = None
    image_pad_bottom_image: str | None = None
    image_pad_left_image: str | None = None
    image_pad_right_image: str | None = None
    image_vertical_pad_color: str | None = None
    image_horizontal_pad_color: str | None = None


class BrandKitOut(BaseModel):
    logo_url: str | None
    primary_color: str
    tagline: str
    logo_placement: str
    vertical_pad_mode: str
    horizontal_pad_mode: str
    pad_top_image_url: str | None
    pad_bottom_image_url: str | None
    pad_left_image_url: str | None
    pad_right_image_url: str | None
    vertical_pad_color: str | None
    horizontal_pad_color: str | None
    image_vertical_pad_mode: str
    image_horizontal_pad_mode: str
    image_pad_top_image_url: str | None
    image_pad_bottom_image_url: str | None
    image_pad_left_image_url: str | None
    image_pad_right_image_url: str | None
    image_vertical_pad_color: str | None
    image_horizontal_pad_color: str | None
    platform_ratio_overrides: dict[str, str] = Field(default_factory=dict)  # {platform_id: ratio} — only platforms this company has overridden; anything absent uses the developer's platform-wide default

    class Config:
        from_attributes = True


class PlatformRatioOverrideIn(BaseModel):
    """Set (or clear, with ratio=null) this company's own override for
    one platform's video ratio — a dedicated endpoint rather than
    cramming a dict-keyed update into the general brand kit PUT, since
    this is a "set one entry" operation, not a whole-object partial
    update like everything else there."""
    platform_id: str = Field(min_length=1, max_length=40)
    ratio: str | None = None  # null clears the override, reverting to the developer default; validated against the developer's current ratio list at the endpoint


class VideoRatiosOut(BaseModel):
    ratios: list[str]


class AddVideoRatioIn(BaseModel):
    ratio: str = Field(min_length=3, max_length=10, pattern=r"^\d+(\.\d+)?:\d+(\.\d+)?$")  # structural check only (e.g. "9:16", "1.91:1") — not a fixed allowed-values list, since the whole point is letting the developer define new ones


class RatioUsageOut(BaseModel):
    """What currently references a ratio — shown as a warning before
    the developer confirms deletion. Deletion is never blocked, only
    warned about; anything still referencing a deleted ratio silently
    falls back to a default afterward (see services/video_ratios.py)."""
    platforms: list[str]
    company_override_count: int


# ---------- Campaigns ----------

class PhaseScheduleIn(BaseModel):
    date: str  # "YYYY-MM-DD"
    time: str = "10:00"  # "HH:MM"
    platforms: list[str] = Field(min_length=1)
    generate_image: bool = False  # per-phase choice — e.g. no image for a teaser, one for the launch
    env: str | None = None  # placement/surroundings, used when product_image is provided
    image_scene: str | None = None  # scene description, used when no product_image
    product_image: str | None = None  # base64 data URL — your own product photo for this phase; also serves as this phase's image reference, same role as Create Ad's image_reference_image
    use_brand_logo: bool = False
    image_model_id: str | None = None  # which entry from GET /ads/available-models to use for this phase's image — same per-ad model choice as Create Ad, not a fixed default
    # Video — same capability set as Create Ad, mutually exclusive with
    # the image fields above at the UI level (a phase generates an image
    # OR a video, not both), enforced client-side; the backend doesn't
    # need to re-enforce this since generate_image/generate_video are
    # independent booleans and nothing breaks if both were somehow true.
    generate_video: bool = False
    video_model_id: str | None = None
    video_shots: list[VideoShotIn] | None = None
    video_frame_image: str | None = None
    video_frame_image_url: str | None = None
    video_end_frame_image: str | None = None  # same "start + end frame" capability as Create Ad — only meaningful when video_mode is "first_last_frame" and the model supports it
    video_end_frame_image_url: str | None = None
    video_mode: str = "single_reference"  # "single_reference" | "first_last_frame" — same as Create Ad
    video_resolution: str | None = None
    video_start_shot_id: str | None = None  # same Brand Kit intro/outro selection as Create Ad
    video_end_shot_id: str | None = None
    video_prompt_override: str | None = None  # applies for any shot count now, same as Create Ad
    refine_video_prompt: bool = False  # opt-in — the developer-configured review model (if any) only runs when this is explicitly checked; off by default since the raw customer wording isn't always worse
    refine_video_frame: bool = False  # opt-in — same as Create Ad, only meaningful in single_reference mode


class CampaignCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    brief: str = Field(min_length=1, max_length=1000)
    teaser: PhaseScheduleIn
    launch: PhaseScheduleIn
    followup: PhaseScheduleIn


class CampaignOut(BaseModel):
    id: uuid.UUID
    name: str
    brief: str
    phases: dict | None  # per phase: caption, date, time, platforms, ad_id
    phase_status: dict = Field(default_factory=dict)  # per phase: "posted" | "partially_posted" | "scheduled" | "no_ad" — computed live, not stored
    created_at: datetime

    class Config:
        from_attributes = True


class CampaignImageIn(BaseModel):
    """Adds/regenerates the image on a phase's ALREADY-CREATED ad (ads are
    now created automatically at campaign creation time, along with their
    schedule) — this does not create a new ad."""
    phase: str = Field(pattern="^(teaser|launch|followup)$")
    env: str | None = None
    image_scene: str | None = None
    product_image: str | None = None
    use_brand_logo: bool = False


class CampaignListOut(BaseModel):
    items: list[CampaignOut]
    total: int
    page: int
    page_size: int


# ---------- Scheduling ----------

class SchedulePostIn(BaseModel):
    ad_id: uuid.UUID
    platforms: list[str] = Field(min_length=1)
    scheduled_at: datetime  # naive UTC datetime from the browser's <input type="datetime-local">


class RescheduleIn(BaseModel):
    scheduled_at: datetime  # naive UTC — same convention as SchedulePostIn


class ScheduledPostOut(BaseModel):
    id: uuid.UUID
    ad_id: uuid.UUID
    platform: str
    scheduled_at: datetime
    status: str
    posted_at: datetime | None
    ad_title: str | None = None       # the linked ad's product name, for display
    campaign_id: uuid.UUID | None = None
    campaign_name: str | None = None
    campaign_phase: str | None = None

    class Config:
        from_attributes = True


class ScheduleListOut(BaseModel):
    """Paginated by GROUP (distinct ad + exact scheduled_at), not by raw
    row — a post scheduled to 3 platforms is 3 rows but ONE group, and
    should never be split across two pages of results. items still
    contains every row belonging to the groups on the current page, so
    the frontend's existing per-group platform display works unchanged."""
    items: list[ScheduledPostOut]
    total_groups: int
    page: int
    page_size: int

# ---------- Moderation ----------

class GuardrailRuleCreateIn(BaseModel):
    phrase: str = Field(min_length=1, max_length=200)


class GuardrailRuleOut(BaseModel):
    id: uuid.UUID
    phrase: str
    created_at: datetime

    class Config:
        from_attributes = True


class FlaggedContentOut(BaseModel):
    id: uuid.UUID
    text: str
    matched_term: str
    resolved: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ModerationOverviewOut(BaseModel):
    default_rules: list[str]
    strikes: int


# ── Agent Niva ──────────────────────────────────────────────────────

class AgentSettingsOut(BaseModel):
    quick_start_mode: str
    event_approval_mode: str
    credit_cap_mode: str
    monthly_credit_budget: int


class AgentSettingsUpdateIn(BaseModel):
    quick_start_mode: str | None = Field(default=None, pattern="^(review_first|auto_draft|auto_schedule)$")
    event_approval_mode: str | None = Field(default=None, pattern="^(draft_only|schedule_review|auto_post)$")
    credit_cap_mode: str | None = Field(default=None, pattern="^(monthly_budget|confirm_each_time|none)$")
    monthly_credit_budget: int | None = Field(default=None, ge=0)


class QuickStartIn(BaseModel):
    url: str = Field(min_length=3, max_length=500)
    count: int = Field(default=5, ge=1, le=10)
    focus: str | None = Field(default=None, max_length=500)  # optional subject focus, e.g. "our summer sale" or "the new iOS app"


class AgentScrapeJobOut(BaseModel):
    id: str
    url: str
    count: int
    status: str
    error: str | None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id(cls, v):
        return str(v)


class AgentRecommendationOut(BaseModel):
    id: str
    source_url: str
    status: str
    title: str
    description: str
    audience: str = ""
    platforms: list[str]
    created_ad_id: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class AgentEventIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    month: int = Field(ge=1, le=12)
    day: int = Field(ge=1, le=31)
    lead_days: int = Field(default=2, ge=0, le=60)
    guidance: str = Field(default="", max_length=1000)
    platforms: list[str] = Field(min_length=1)
    product_id: uuid.UUID | None = None
    enabled: bool = True
    approval_mode: str | None = Field(default=None, pattern="^(draft_only|schedule_review|auto_post)$")


class AgentEventOut(BaseModel):
    id: str
    name: str
    month: int
    day: int
    lead_days: int
    guidance: str
    platforms: list[str]
    product_id: str | None = None
    enabled: bool
    approval_mode: str
    skipped_years: list[int]
    last_run_year: int | None = None
    next_run_date: str | None = None  # computed

    class Config:
        from_attributes = True


class NotificationOut(BaseModel):
    id: str
    type: str
    title: str
    body: str
    action_url: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Scraped Sites ────────────────────────────────────────────────────

class ScrapedSiteOut(BaseModel):
    id: uuid.UUID
    url: str
    label: str
    scraped_at: datetime

    class Config:
        from_attributes = True


class ScrapedSiteLabelIn(BaseModel):
    label: str = Field(max_length=200)


class QuickStartFromSiteIn(BaseModel):
    count: int = Field(default=5, ge=1, le=10)
    focus: str | None = Field(default=None, max_length=500)
