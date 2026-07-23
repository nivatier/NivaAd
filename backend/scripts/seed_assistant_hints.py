"""One-time seed script for the assistant's original starter hint set.

Assistant hints are no longer hardcoded anywhere in the application — they
live exclusively in ModelConfig(id=1).config["assistant_hints"] and are
managed entirely from Developer > Assistant. This script exists purely so
that a fresh environment (or one migrating off the old hardcoded-defaults
behaviour) can be bootstrapped with the original starter messages in one
shot, instead of typing all 25 of them into the panel by hand.

It is NOT imported or run automatically by the application — run it
yourself, once, if you want the starter set:

    docker compose exec api python scripts/seed_assistant_hints.py

Safe to re-run: it only adds hints whose `key` isn't already present, it
never overwrites or deletes anything you've since edited in the panel.
"""
import asyncio

from app.database import SessionLocal
from app.services.assistant_hints import get_assistant_hints, set_assistant_hints

STARTER_HINTS = [
    {"id": "nav-create-ad",   "key": "nav:create-ad",               "label": "Nav — Create Ad",              "message": "This is where you generate a new ad — write a product description, pick platforms, and choose what to generate: text, image, or video.",                                     "audio_url": None},
    {"id": "nav-campaigns",   "key": "nav:campaigns",               "label": "Nav — Campaigns",              "message": "Campaigns let you plan a multi-phase launch — teaser, launch, and follow-up ads — all linked together and scheduled as one sequence.",                                   "audio_url": None},
    {"id": "nav-my-ads",      "key": "nav:my-ads",                  "label": "Nav — My Ads",                 "message": "Every ad you've generated lives here — status, schedule, and quick actions like repost or delete, all in one list.",                                                       "audio_url": None},
    {"id": "nav-calendar",    "key": "nav:calendar",                "label": "Nav — Calendar",               "message": "See everything scheduled or posted this month, laid out by week, so gaps in your posting schedule jump right out.",                                                        "audio_url": None},
    {"id": "nav-products",    "key": "nav:products",                "label": "Nav — Products",               "message": "Group your ads by product line — Create Ad and My Ads can then filter and tag things automatically.",                                                                     "audio_url": None},
    {"id": "nav-brand-kit",   "key": "nav:brand-kit",               "label": "Nav — Brand Kit",              "message": "Set your brand's colors, logo, and padding styles here so generated images stay on-brand across every platform and aspect ratio.",                                        "audio_url": None},
    {"id": "nav-connections", "key": "nav:connections",             "label": "Nav — Connections",            "message": "Connect your social platform accounts here so ads can actually be posted or scheduled, not just generated.",                                                              "audio_url": None},
    {"id": "nav-moderation",  "key": "nav:moderation",              "label": "Nav — Moderation",             "message": "Review flagged content and manage the guardrail rules that keep generated ads compliant.",                                                                                "audio_url": None},
    {"id": "nav-settings",    "key": "nav:settings",                "label": "Nav — Settings",               "message": "Manage your team, billing, and account-level preferences here.",                                                                                                         "audio_url": None},
    {"id": "nav-analytics",   "key": "nav:analytics",               "label": "Nav — Analytics",              "message": "Track how your posted ads are performing across platforms.",                                                                                                              "audio_url": None},
    {"id": "nav-admin",       "key": "nav:admin",                   "label": "Nav — Admin",                  "message": "Admin-only controls for managing your company's users and permissions.",                                                                                                  "audio_url": None},
    {"id": "field-text-theme","key": "field:text-theme-reference",  "label": "Field — Text Theme Reference", "message": "Pick a Style and a Product category here — their prompts combine to describe the AI-generated background. No product photo needed for this one.",                        "audio_url": None},
    {"id": "field-img-theme", "key": "field:image-theme-reference", "label": "Field — Image Theme Reference","message": "Choose a real reference image whose look you want to match — its style and tags shape the generated scene around your product.",                                        "audio_url": None},
    {"id": "system-sleep",    "key": "system:sleep",                "label": "System — Going to sleep",      "message": "Going to sleep now — wake me up by pressing the green button!",                                                                                                          "audio_url": None},
    {"id": "system-wake",     "key": "system:wake",                 "label": "System — Waking up",           "message": "I'm awake and ready to help!",                                                                                                                                           "audio_url": None},
    {"id": "field-text-model",   "key": "field:text-model",         "label": "Field — Text Model",           "message": "This is the AI model that writes your ad copy. Different models have different styles and costs — higher-tier models tend to write sharper, more persuasive text.",                                   "audio_url": None},
    {"id": "field-variations",   "key": "field:variations",         "label": "Field — Variations",           "message": "Choose 1 version for a single polished ad, or 3 variations to A/B test different angles and see which one resonates most with your audience.",                                                       "audio_url": None},
    {"id": "field-goal-tone",    "key": "field:campaign-goal-tone", "label": "Field — Campaign Goal & Tone", "message": "Goal shapes what the ad tries to achieve — driving sales, building awareness, or getting clicks. Tone shapes how it sounds — professional, playful, urgent, and so on.",                             "audio_url": None},
    {"id": "field-image-model",  "key": "field:image-model",        "label": "Field — Image Model",          "message": "The AI model that generates your ad image. Some models are photorealistic, others more illustrative — pick the one that suits your brand style.",                                                    "audio_url": None},
    {"id": "field-img-ref",      "key": "field:image-reference",    "label": "Field — Reference Image",      "message": "Upload your actual product photo here and the AI will generate a scene around it — keeping your product front and centre. Skip this for a fully imagined background.",                               "audio_url": None},
    {"id": "field-img-format",   "key": "field:image-format",       "label": "Field — Image Format",         "message": "Single gives you one polished image. Carousel generates multiple images as a swipeable sequence — great for showing different angles or telling a story.",                                            "audio_url": None},
    {"id": "field-img-describe", "key": "field:image-describe",     "label": "Field — Describe the Image",   "message": "Describe the mood, setting, and style you want — or pick a theme reference below to use a pre-built style. The more specific you are, the closer the result matches your vision.",                  "audio_url": None},
    {"id": "field-video-model",  "key": "field:video-model",        "label": "Field — Video Model",          "message": "The AI model that generates your video. Different models support different lengths, resolutions, and whether you can supply a starting frame — check the options below after selecting.",        "audio_url": None},
    {"id": "field-video-ref",    "key": "field:video-reference",    "label": "Field — Video Reference Image","message": "Upload a photo to use as the video's opening frame — the AI animates outward from it. Skip this for a fully AI-generated video described entirely by your prompt.",                              "audio_url": None},
    {"id": "field-video-theme",  "key": "field:video-theme",        "label": "Field — Video Theme",          "message": "Choose a pre-built video theme — each one includes professionally written shot directions and timings that the AI follows. You can still edit the shot prompts after selecting a theme, or choose Custom to write your own from scratch.",  "audio_url": None},

    # ── Themes Gallery ──────────────────────────────────────────────────
    {"id": "page-image-theme-gallery", "key": "page:image-theme-gallery", "label": "Page — Image Theme Gallery",   "message": "Browse all available image themes — each one gives the AI a distinct visual style to wrap around your product. Click any theme to start creating an ad with that look.", "audio_url": None},
    {"id": "page-video-theme-gallery", "key": "page:video-theme-gallery", "label": "Page — Video Theme Gallery",   "message": "Browse video themes — each one comes with pre-written shot directions and timings. Selecting one kicks off a new ad in Create Ad with those shots already filled in.", "audio_url": None},

    # ── Agent Niva ──────────────────────────────────────────────────────
    {"id": "page-quick-start",         "key": "page:quick-start",         "label": "Page — Quick Start",           "message": "Give Agent Niva your website URL and it reads the page, then suggests concrete ad ideas tailored to what it finds. Each suggestion can be turned into a real ad with one click.", "audio_url": None},
    {"id": "page-recurring-events",    "key": "page:recurring-events",    "label": "Page — Recurring Events",      "message": "Set up yearly occasions — like Christmas, a summer sale, or your brand anniversary — and Agent Niva will automatically generate and schedule an ad a few days before each one, every year.", "audio_url": None},

    # ── Brand Kit ───────────────────────────────────────────────────────
    {"id": "page-brand-logo",          "key": "page:brand-logo",          "label": "Page — Logo & Brand",          "message": "Upload your logo, set your primary brand colour, and write a tagline here. The active logo gets composited onto generated images when you tick Include logo in Create Ad.", "audio_url": None},
    {"id": "page-image-padding",       "key": "page:image-padding",       "label": "Page — Image Padding",        "message": "When a generated image doesn't match a platform's required aspect ratio, padding fills the gaps. Choose a blurred version of the image, a solid brand colour, or your own custom bar images for the top, bottom, left, and right sides.", "audio_url": None},
    {"id": "page-video-padding",       "key": "page:video-padding",       "label": "Page — Video Padding",        "message": "Same as image padding but for generated videos — independently configurable so your videos and images can each have their own look when letterboxed or pillarboxed to fit a platform's required format.", "audio_url": None},
    {"id": "page-video-shots",         "key": "page:video-shots",         "label": "Page — Video Intro & Credit Shots", "message": "Generate short branded intro and outro clips here — a few seconds each. They get stitched onto the start and end of your AI-generated ads in Create Ad, giving every video a consistent branded opening and closing.", "audio_url": None},

    # ── Admin ───────────────────────────────────────────────────────────
    {"id": "page-admin-users",         "key": "page:admin-users",         "label": "Page — Admin Users",           "message": "Invite and manage your company's team members here. You can assign roles — admin, editor, or poster — and enable or disable accounts. Invites go out by email with a secure link to set a password.", "audio_url": None},
    {"id": "page-admin-profiles",      "key": "page:admin-profiles",      "label": "Page — Admin Profiles",        "message": "Control exactly what each role can see and do — which pages appear in the sidebar, and which actions like creating ads or posting are available. Changes take effect immediately and are enforced by the backend on every request.", "audio_url": None},
]


async def main():
    async with SessionLocal() as db:
        existing = await get_assistant_hints(db)
        existing_keys = {h["key"] for h in existing}
        added = [h for h in STARTER_HINTS if h["key"] not in existing_keys]
        if not added:
            print("Nothing to add — every starter key already exists in the DB.")
            return
        merged = existing + [dict(h) for h in added]
        await set_assistant_hints(db, merged)
        print(f"Added {len(added)} hint(s): {', '.join(h['key'] for h in added)}")


if __name__ == "__main__":
    asyncio.run(main())
