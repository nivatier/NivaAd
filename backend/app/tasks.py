"""Celery generation tasks.

Workers run synchronously, so they use a sync SQLAlchemy engine
(the async one belongs to FastAPI request handlers).
"""
import base64
import json
import logging
from datetime import date, datetime, timedelta

import httpx
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.config import settings
from app.models import Ad, AgentEvent, AgentRecommendation, AgentScrapeJob, BrandKit, BrandLogo, BrandVideoShot, CreditLedger, GenerationJob, Notification, PlatformConnection, Product, ScheduledPost
from app.services import storage
from app.services import linkedin
from app.services.agent_scraper import scrape_company_website
from app.services.agent_settings import get_agent_settings_sync
from app.services.branding import composite_logo
from app.services.images import generate_image
from app.services.credits import get_available_models_sync
from app.services.retention import get_post_retention_months_sync, get_retention_months_sync
from app.services import text_gen
from app.services.platform_config import get_ad_targeting_ratios_sync
from app.services.reframe import add_text_overlay, concat_video_clips, extract_last_frame, prepare_video_reference_frame, probe_video_url_dimensions, reframe_image, reframe_video, reframe_video_to_dims, strip_audio
from app.services.video_ratios import get_video_ratios_sync, resolve_ratio
from app.services.video_prep import get_video_prep_settings_sync
from app.services.token_crypto import decrypt_token
from app.services.videos import generate_video
from app.worker import celery_app

logger = logging.getLogger("nivaad.tasks")
logging.basicConfig(level=logging.INFO)

sync_engine = create_engine(
    settings.DATABASE_URL.replace("+asyncpg", "+psycopg"), pool_pre_ping=True
)


PLATFORM_STYLE = {
    "instagram": "engaging, visual-first, emoji-friendly",
    "facebook": "conversational, community-toned",
    "linkedin": "professional, longer, outcome-focused",
    "x": "short and punchy, under 280 characters",
    "tiktok": "trendy, hook-first, gen-z friendly",
}


def _shape(platforms: list[str]) -> str:
    inner = ",".join(
        f'"{p}":{{"caption":"...","hashtags":["#.."],"score":85,"tip":"one short improvement tip"}}'
        for p in platforms
    )
    return "{" + inner + "}"


def _build_prompt(brief: dict, platforms: list[str], outputs: dict, feedback: str | None) -> str:
    fmt = outputs.get("format", "single")
    variations = outputs.get("variations", 1)
    styles = "; ".join(f"{p}: {PLATFORM_STYLE.get(p, 'platform-appropriate')}" for p in platforms)
    base = (
        "You are an expert social media ad copywriter and creative reviewer. "
        f"Product: {brief.get('product_name')}. Description: {brief.get('description')}. "
        f"Target audience: {brief.get('audience') or 'general consumers'}. "
        f"Offer: {brief.get('offer') or 'none'}. Campaign goal: {brief.get('goal')}. "
        f"Tone: {brief.get('tone')}. "
    )
    scene = brief.get("env") or brief.get("image_scene")
    if scene:
        base += f"The ad image's scene/environment: {scene}. "
    if brief.get("tagline"):
        base += f'Weave in the brand tagline naturally: "{brief["tagline"]}". '
    if fmt == "carousel":
        base += "Format: 3-slide carousel — the caption should tease a swipe. "
    base += (
        f"Write ad copy for these platforms, adapted per platform ({styles}). "
        "For each platform also rate the copy 0-100 for predicted engagement (score) "
        "and give one concrete improvement tip. "
    )
    if feedback:
        base += f'The customer requested these changes: "{feedback}". Apply them. '
        base += f"Respond ONLY with raw JSON, no markdown fences: {_shape(platforms)}"
    elif variations == 3:
        s = _shape(platforms)
        base += (
            "Produce 3 distinct creative angles. "
            f'Respond ONLY with raw JSON, no markdown fences: {{"variants":[{s},{s},{s}]}}'
        )
    else:
        base += f"Respond ONLY with raw JSON, no markdown fences: {_shape(platforms)}"
    return base


def _video_prompt(brief: dict, shot_description: str | None = None) -> str:
    """Video generation rewards specificity about motion, camera
    movement, and pacing far more than static image prompts do (per
    OpenRouter's own guidance) — so this deliberately asks for those
    details explicitly, rather than reusing the image prompt as-is.

    When shot_description is given, it's trusted as the PRIMARY,
    complete direction — no longer diluted with the full marketing
    description (that's copy written for a human reading an ad caption,
    not visual direction for a video model; it can contain phone
    numbers, CTAs, and other text with nothing to do with what the
    video should show) or generic camera-movement boilerplate that could
    directly conflict with what the customer already specified (e.g.
    their own "match-cut dissolve" vs. this function's old blanket
    "keep pacing calm, not frantic" instruction). The fuller generic
    template is now a fallback ONLY for the no-shot-description case,
    where there's nothing specific to build from."""
    product = brief.get("product_name", "the product")
    if shot_description:
        return (
            f'Professional advertising video for "{product}". {shot_description} '
            "High-end commercial advertising style, no text overlay, no watermark."
        )
    p = f"Professional advertising video for a product called \"{product}\". "
    if brief.get("image_scene"):
        p += f"Setting: {brief['image_scene']}. "
    else:
        p += "Setting: clean studio background, soft professional lighting. "
    p += (
        "Include smooth, natural camera movement (e.g. a slow push-in, gentle orbit, or subtle pan) "
        "and any product-appropriate motion (e.g. light catching a surface, gentle rotation, ambient movement "
        "in the background). Keep pacing calm and premium, not frantic. "
        "High-end commercial advertising style, no text overlay, no watermark."
    )
    return p


def _multi_shot_video_prompt(brief: dict, shots: list[dict]) -> str:
    """Combines multiple shots into ONE prompt with explicit timing
    markers — this is what actually gets sent as a SINGLE prompt to a
    SINGLE generation call, not one call per shot. Follows the exact
    format OpenAI's own Sora documentation recommends for multi-shot
    sequences ("Shot 1 (0-4s): ... Shot 2 (4-8s): ..."); the model
    itself handles continuity and transitions between shots — there is
    no video-processing/stitching step on NivaSpark's side at all."""
    product = brief.get("product_name", "the product")
    intro = (
        f'Professional advertising video for "{product}". '
        "This video has multiple distinct shots in sequence, each described below with its exact timing — "
        "follow the shot breakdown precisely, keeping the same product and a consistent overall visual style "
        "across every shot.\n\n"
    )
    lines = []
    elapsed = 0
    for i, shot in enumerate(shots):
        duration = shot.get("duration") or 6
        start, end = elapsed, elapsed + duration
        desc = (shot.get("prompt") or "").strip() or "continue the scene naturally"
        lines.append(f"Shot {i + 1} ({start}-{end}s): {desc}")
        elapsed = end
    outro = (
        "\n\nHigh-end commercial advertising style throughout, smooth cinematic transitions between shots, "
        "no text overlay, no watermark."
    )
    return intro + "\n".join(lines) + outro


def _image_prompt(brief: dict, slide_description: str | None = None) -> str:
    """slide_description, when given (carousel mode), is blended into the
    scene for THIS specific slide — every slide still shows the same
    product (from the reference photo, if one was given), just staged
    differently. Omitted entirely for single-image ads (default None),
    so existing behavior is unchanged.

    FIXED 2026-07-13: was checking brief["product_image_url"], which
    stopped being populated once the dedicated image_reference_image
    field was introduced (Create Ad's Steps 1-3 merge) — every ad
    created since then had its reference photo correctly sent to the
    actual generation call, but the PROMPT TEXT itself silently fell
    back to the no-reference wording, ignoring that a photo was
    attached. Checks image_reference_image_url first now, matching
    exactly what the real API call uses, falling back to
    product_image_url only for ads created before that field existed."""
    product = brief.get("product_name", "the product")
    overlay = (brief.get("text_overlay") or "").strip()
    overlay_line = (
        f"- Also render this text directly on the image, exactly as written, positioned as described: {overlay}\n"
        if overlay else ""
    )
    style_tail = (
        "High-end commercial ad photography style, sharp focus, no watermark."
        if overlay else
        "High-end commercial ad photography style, sharp focus, no text overlay, no watermark."
    )
    reference_url = brief.get("image_reference_image_url") or brief.get("product_image_url")
    if reference_url:
        base_scene = brief.get("env") or "a clean, professional studio setting with soft natural lighting"
        scene = f"{base_scene}. Specifically for this shot: {slide_description}" if slide_description else base_scene
        return (
            "TASK: Photo composition / background replacement around a FIXED, UNCHANGED subject — NOT a new "
            "product, NOT a reimagined product, and NOT a light edit either.\n"
            f"You are given one reference photo of a real product ({product}). Treat that exact product as fixed "
            "material to be relocated, not redesigned: extract it precisely as shown — identical shape, color, "
            "texture, proportions, and any visible branding or labels must carry over exactly.\n"
            f"Your job is to place THIS SAME, UNCHANGED product into a new setting: \"{scene}\". Everything about "
            "the product stays identical to the reference photo; only what surrounds it changes.\n"
            "Requirements:\n"
            f"- The ENTIRE background and environment must become: {scene}. Do not reuse or keep any part of the "
            "original reference photo's background, surface, or setting — replace all of it.\n"
            "- The product itself must look identical to the reference (do not redesign, recolor, or restyle it) — "
            "this is the same physical object appearing in a different location, not a new photograph of a similar item.\n"
            "- Add realistic lighting, shadows, and reflections consistent with the new environment so the "
            "product looks physically present in that scene, not pasted on top of it.\n"
            "- This is a full scene generation task around a fixed subject, similar to professional product "
            "photography composited on location.\n"
            "- FRAMING: the ENTIRE product must be fully visible within the frame, with clear margin on all "
            "sides — do not crop, cut off, or zoom in past any edge of the product. Compose the shot wider "
            "rather than tighter if in doubt; a fully visible product matters more than a dramatic close-up.\n"
            f"{overlay_line}"
            f"{style_tail}"
        )
    else:
        p = f"Professional advertising photograph for a product called \"{product}\". "
        p += f"{brief.get('description', '')} "
        if slide_description:
            p += f"For this specific image: {slide_description}. "
        elif brief.get("image_scene"):
            p += f"Desired background, environment and style: {brief['image_scene']}. "
        else:
            p += "Setting: clean studio background, soft professional lighting. "
        p += "Compose the shot so the ENTIRE product is fully visible with clear margin on all sides — do not crop or cut off any part of it. "
        if overlay:
            p += f"Also render this text directly on the image, exactly as written, positioned as described: {overlay} "
        p += style_tail
        return p


def _video_frame_prep_prompt(product: str, scene_description: str) -> str:
    """The actual fix for the 'first frames show the reference photo's
    original background, not the described scene' problem — mirrors
    _image_prompt's fixed-subject/new-setting template exactly, but the
    scene comes directly from the video's first shot description
    (what the customer actually wrote for that shot) rather than the
    image section's own placement field, since that's what the opening
    frames need to match. Only called when both a reference image AND
    a developer-configured prep image model exist — see
    services/video_prep.py."""
    return (
        "TASK: Photo composition / background replacement around a FIXED, UNCHANGED subject — NOT a new "
        "product, NOT a reimagined product, and NOT a light edit either.\n"
        f"You are given one reference photo of a real product ({product}). Treat that exact product as fixed "
        "material to be relocated, not redesigned: extract it precisely as shown — identical shape, color, "
        "texture, proportions, and any visible branding or labels must carry over exactly.\n"
        f"Your job is to place THIS SAME, UNCHANGED product into a new setting, matching exactly what this video "
        f"shot describes: \"{scene_description}\". Everything about the product stays identical to the reference "
        "photo; only what surrounds it changes.\n"
        "Requirements:\n"
        f"- The ENTIRE background and environment must become what the shot describes: {scene_description}. Do "
        "not reuse or keep any part of the original reference photo's background, surface, or setting — replace "
        "all of it.\n"
        "- The product itself must look identical to the reference (do not redesign, recolor, or restyle it) — "
        "this is the same physical object appearing in a different location, not a new photograph of a similar item.\n"
        "- Add realistic lighting, shadows, and reflections consistent with the new environment so the "
        "product looks physically present in that scene, not pasted on top of it.\n"
        "- This image will become the FIRST FRAME of a video — compose it as a natural starting point for the "
        "motion the shot describes, not a static portrait.\n"
        "- FRAMING: the ENTIRE product must be fully visible within the frame, with clear margin on all "
        "sides — do not crop, cut off, or zoom in past any edge of the product.\n"
        "High-end commercial ad photography style, sharp focus, no text overlay, no watermark."
    )


def _review_shot_prompt(raw_prompt: str, review_model: str) -> str:
    """Sends one video shot's raw description to the developer-configured
    review model, asking it to strengthen the prompt for video
    generation specifically (concrete visual/motion language, not just
    'nicer wording') — returns the improved text, or the original
    unchanged if the review call fails for any reason, so a review
    hiccup never blocks the actual video generation."""
    if not raw_prompt or not raw_prompt.strip():
        return raw_prompt
    instruction = (
        "You are improving a single shot description for an AI video generation model. Rewrite the shot below "
        "to be more concrete and effective for video generation — specific camera movement, motion, lighting, "
        "and atmosphere — while preserving the original creative intent exactly (same subject, same setting, "
        "same mood). Keep it to one or two sentences. Respond with ONLY the rewritten shot description, no "
        "preamble, no quotes, no JSON, no explanation.\n\n"
        f"Original shot: \"{raw_prompt}\""
    )
    try:
        resp = httpx.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}", "Content-Type": "application/json"},
            json={"model": review_model, "max_tokens": 300, "messages": [{"role": "user", "content": instruction}]},
            timeout=30,
        )
        resp.raise_for_status()
        improved = resp.json()["choices"][0]["message"]["content"].strip().strip('"')
        return improved if improved else raw_prompt
    except Exception as exc:  # noqa: BLE001
        logger.warning("[video_prep] shot prompt review failed, using original: %s", exc)
        return raw_prompt



@celery_app.task(name="app.generate_brand_video_shot", bind=True, max_retries=0)
def generate_brand_video_shot(self, shot_id: str):
    """Generates one Brand Kit intro/outro clip — same idea as the video
    portion of generate_ad below, just standalone (no Ad/GenerationJob
    involved; BrandVideoShot carries its own status/error directly).
    Credits were already deducted when the shot was queued (see
    routers/brand_kit.py) — refunded here on failure.

    Two extra inputs beyond a plain prompt, both optional:
    - reference_logo_id: sent to the video model as the starting frame,
      so the AI generates around/animates the company's ACTUAL logo
      rather than guessing at one from the text prompt alone.
    - overlay_text: burned in via ffmpeg drawtext AFTER generation —
      never left to the AI model to render as text, since video models
      are unreliable at exact, legible text (same "AI does the visuals,
      code renders the exact text" split as image logo compositing)."""
    with Session(sync_engine) as db:
        shot = db.get(BrandVideoShot, shot_id)
        if shot is None:
            return "shot not found"
        shot.status = "running"
        db.commit()
        try:
            frame_image_url = None
            if shot.reference_logo_id:
                logo = db.get(BrandLogo, shot.reference_logo_id)
                if logo:
                    try:
                        brand_kit_for_frame = db.scalar(select(BrandKit).where(BrandKit.company_id == shot.company_id))
                        if brand_kit_for_frame is not None:
                            # Fit-and-pad the logo into the SHOT'S TARGET
                            # ratio/style BEFORE the AI ever sees it —
                            # fixes a real failure mode where a
                            # differently-shaped logo (e.g. 16:9) sent
                            # as-is, then the resulting video reframed
                            # to a different ratio (e.g. 1:1)
                            # afterward, produces two visibly different
                            # padding styles stacked on top of each
                            # other. Preparing it first means the AI's
                            # whole generation starts from something
                            # that already matches how the final video
                            # will look.
                            prepared_bytes = prepare_video_reference_frame(logo.url, shot.ratio, brand_kit_for_frame)
                            frame_image_url = f"data:image/png;base64,{base64.b64encode(prepared_bytes).decode()}"
                        else:
                            logger.warning("[brand_video_shot] shot=%s no Brand Kit yet — using logo as-is, unshaped", shot_id)
                            frame_image_url = storage.fetch_as_data_url(logo.url)
                    except Exception as fetch_exc:  # noqa: BLE001
                        logger.warning("[brand_video_shot] shot=%s could not prepare reference logo %s, generating without it: %s", shot_id, shot.reference_logo_id, fetch_exc)
                else:
                    logger.warning("[brand_video_shot] shot=%s reference logo %s no longer exists — generating without it", shot_id, shot.reference_logo_id)

            # Logo fidelity: the reference frame anchors the FIRST frame,
            # but video models will happily "reinterpret" the logo as the
            # clip plays — redrawing, restyling, or morphing it. Appended
            # server-side (not stored on shot.prompt) so the customer's
            # own wording stays clean in the gallery, and every
            # logo-referenced generation gets the instruction whether or
            # not they thought to write it.
            gen_prompt = shot.prompt
            if frame_image_url:
                gen_prompt = (
                    f"{shot.prompt.rstrip('. ')}. "
                    "The logo shown in the reference image must remain EXACTLY as it is throughout the entire video — "
                    "identical shape, colors, proportions, and any text in it. Do not redraw, restyle, distort, morph, "
                    "recolor, or replace the logo at any point."
                )

            # audio=False is only SENT when the customer asked for a
            # silent clip — otherwise None, letting the provider's own
            # default apply (same convention as generate_ad's video path).
            video_bytes = generate_video(gen_prompt, shot.model_used, duration=shot.duration, resolution="720p", frame_image_url=frame_image_url, audio=False if shot.mute_audio else None)

            if shot.mute_audio:
                # The audio=False flag above is a request; this is the
                # guarantee — not every model/provider honors the flag,
                # so any audio track that still came back is stripped
                # here (video stream copied as-is, no re-encode) before
                # anything downstream sees it.
                try:
                    video_bytes = strip_audio(video_bytes)
                except Exception as strip_exc:  # noqa: BLE001
                    logger.warning("[brand_video_shot] shot=%s audio strip failed, continuing with the clip as generated: %s", shot_id, strip_exc)

            # Reframe to the company's chosen ratio — AI video models
            # generate at their own native shape (usually 16:9)
            # regardless of what's asked for, so getting anything else
            # means padding after the fact, same pipeline used for every
            # other video reframe in the app (reuses the company's own
            # Brand Kit video padding settings for consistency).
            try:
                brand_kit = db.scalar(select(BrandKit).where(BrandKit.company_id == shot.company_id))
                if brand_kit is not None:
                    temp_url = storage.upload_bytes(video_bytes, "video/mp4", "mp4")
                    video_bytes = reframe_video(temp_url, shot.ratio, brand_kit)
                else:
                    logger.warning("[brand_video_shot] shot=%s no Brand Kit yet — skipping ratio reframe, using native shape", shot_id)
            except Exception as reframe_exc:  # noqa: BLE001
                logger.warning("[brand_video_shot] shot=%s ratio reframe to %s failed, using native shape: %s", shot_id, shot.ratio, reframe_exc)

            if shot.overlay_text and shot.overlay_text.strip():
                try:
                    video_bytes = add_text_overlay(video_bytes, shot.overlay_text, shot.overlay_font or "sans", shot.overlay_text_color or "#ffffff", shot.overlay_position or "bottom_center", shot.overlay_font_size or "medium")
                except Exception as overlay_exc:  # noqa: BLE001
                    # The clip itself still generated fine — losing just
                    # the text overlay is far better than losing the
                    # whole shot over what's a code-side finishing touch.
                    logger.warning("[brand_video_shot] shot=%s text overlay failed, using plain clip: %s", shot_id, overlay_exc)

            shot.url = storage.upload_bytes(video_bytes, "video/mp4", "mp4")
            try:
                poster_bytes = extract_last_frame(video_bytes)
                shot.poster_url = storage.upload_bytes(poster_bytes, "image/jpeg", "jpg")
            except Exception as poster_exc:  # noqa: BLE001
                # Gallery just falls back to no thumbnail — never worth
                # failing a whole successful generation over.
                logger.warning("[brand_video_shot] shot=%s poster frame extraction failed: %s", shot_id, poster_exc)
            shot.status = "ready"
            db.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("[brand_video_shot] shot=%s generation failed: %s", shot_id, exc)
            shot.status = "failed"
            shot.error = str(exc)[:1000]
            models = get_available_models_sync(db)
            model = next((m for m in models.get("video", []) if m.get("model") == shot.model_used), None)
            refund = model["credits"] if model else 0
            if refund > 0:
                db.add(CreditLedger(company_id=shot.company_id, delta=refund, reason="refund", ref_id=str(shot.id)))
            db.commit()
        return "done"


def _stitch_intro_outro(db: Session, brief: dict, company_id, video_url: str, log_prefix: str) -> str:
    """If this ad's brief selected a Brand Kit intro (Start) and/or
    outro (End) shot, reframes each selected shot to EXACTLY the main
    video's own pixel dimensions and concatenates [intro?, main,
    outro?] via ffmpeg — returning the stitched result as the new
    video_url. Called BEFORE the per-platform ratio reframe pass below,
    which then operates on whichever url this returns — so the
    intro/outro end up baked into every platform's final version too,
    with zero changes needed to that existing per-ratio loop.

    Returns the ORIGINAL video_url unchanged (and never raises) if
    neither shot is selected, if a selected shot was since deleted, or
    if stitching fails for any reason — a company's ad still finishes
    with its plain generated video rather than losing the whole
    generation over what's fundamentally a bonus finishing touch.
    """
    start_id = brief.get("video_start_shot_id")
    end_id = brief.get("video_end_shot_id")
    if not start_id and not end_id:
        return video_url
    try:
        brand_kit = db.scalar(select(BrandKit).where(BrandKit.company_id == company_id))
        if brand_kit is None:
            return video_url

        def _load_shot(shot_id):
            if not shot_id:
                return None
            shot = db.get(BrandVideoShot, shot_id)
            if shot is None or shot.company_id != company_id or shot.status != "ready" or not shot.url:
                logger.warning("[stitch] %s intro/outro shot %s missing/not ready — skipping it, not the whole generation", log_prefix, shot_id)
                return None
            return shot

        start_shot = _load_shot(start_id)
        end_shot = _load_shot(end_id)
        if start_shot is None and end_shot is None:
            return video_url

        tw, th = probe_video_url_dimensions(video_url)
        clips: list[bytes] = []
        if start_shot:
            clips.append(reframe_video_to_dims(start_shot.url, tw, th, brand_kit))
        main_bytes, _ = storage.fetch_bytes(video_url)
        clips.append(main_bytes)
        if end_shot:
            clips.append(reframe_video_to_dims(end_shot.url, tw, th, brand_kit))

        stitched_bytes = concat_video_clips(clips)
        stitched_url = storage.upload_bytes(stitched_bytes, "video/mp4", "mp4")
        logger.info("[stitch] %s produced stitched video (start=%s, end=%s), url=%s", log_prefix, bool(start_shot), bool(end_shot), stitched_url)
        return stitched_url
    except Exception as exc:  # noqa: BLE001
        logger.warning("[stitch] %s intro/outro stitching failed, using plain video unaffected: %s", log_prefix, exc)
        return video_url


@celery_app.task(name="app.generate_ad", bind=True, max_retries=0)
def generate_ad(self, job_id: str, feedback: str | None = None, variant: int = 0, skip_reference: bool = False):
    with Session(sync_engine) as db:
        job = db.get(GenerationJob, job_id)
        if job is None:
            return "job not found"
        ad = db.get(Ad, job.ad_id)
        job.status = "running"
        db.commit()

        try:
            if not feedback and ad.brief.get("text_prompt_override"):
                prompt = ad.brief["text_prompt_override"]
                logger.info("[text_prompt] job=%s USING OVERRIDE from confirmation popup", job_id)
            else:
                prompt = _build_prompt(ad.brief, ad.platforms, ad.outputs, feedback)
            text_model = ad.brief.get("text_model") or "google/gemini-2.5-flash"  # resolved once at ad-creation time (ads.py), not re-looked-up here — same pattern as image_model/video_model
            parsed = text_gen.generate_text(prompt, text_model)
            models_used = [text_model]  # text/copy generation always happens; image/video append below if used

            if feedback:
                results = ad.results or {"variants": [{}]}
                variants = list(results.get("variants", [{}]))
                idx = min(max(variant, 0), len(variants) - 1)
                variants[idx] = {**variants[idx], **parsed, "image_url": variants[idx].get("image_url")}
                new_results = {"variants": variants}
            elif "variants" in parsed:
                new_results = {"variants": parsed["variants"]}
            else:
                new_results = {"variants": [parsed]}

            if not feedback and ad.outputs.get("image"):
                try:
                    ref_urls = None
                    # Prefer the DEDICATED image reference (set explicitly
                    # in Step 2's AI image section) over the general
                    # product photo from Step 1 — same explicit-over-
                    # implicit principle already applied to video's frame
                    # image, so it's always clear which photo is actually
                    # driving generation.
                    image_ref_url = None if skip_reference else (ad.brief.get("image_reference_image_url") or ad.brief.get("product_image_url"))
                    if image_ref_url:
                        data_url = storage.fetch_as_data_url(image_ref_url)
                        ref_urls = [data_url]

                    logo_url = ad.brief.get("brand_logo_url")
                    logo_bytes = None
                    if logo_url:
                        try:
                            logo_bytes, _ = storage.fetch_bytes(logo_url)
                        except Exception as brand_fetch_exc:  # noqa: BLE001
                            logger.warning("[branding] job=%s could not fetch logo, skipping: %s", job_id, brand_fetch_exc)
                    placement = ad.brief.get("brand_logo_placement") or "bottom-right"
                    image_model_used = ad.brief.get("image_model") or "google/gemini-2.5-flash-image"  # resolved once at ad-creation time (ads.py), not re-looked-up here — falls back to a sane default only if brief predates this field (old ads)

                    is_carousel = ad.outputs.get("format") == "carousel" and not ad.brief.get("image_prompt_override")

                    if is_carousel:
                        slides = ad.brief.get("carousel_slides") or []
                        # Per-slide theme overrides (Text/Image Theme Reference chosen
                        # independently per carousel slide) — falls back to the single
                        # shared env/image_scene/text_overlay for ads created before
                        # this existed, or for any slide left on "same as ad" by not
                        # sending an override.
                        carousel_theme = ad.brief.get("carousel_theme") or []
                        # FIXED 2026-07-18: was `len(slides) if slides else 2`. Once
                        # carousel_theme replaced the old free-text per-slide
                        # description as the primary mechanism, carousel_slides is
                        # always empty on new ads — so this unconditionally fell back
                        # to a hardcoded 2 images, silently ignoring whatever count
                        # the user actually chose (3, 5, whatever). carousel_theme's
                        # length IS the real chosen count now; carousel_slides is kept
                        # as a second fallback only for ads created before this change.
                        slide_count = len(carousel_theme) or len(slides) or 2
                        logger.info("[image_prompt] job=%s carousel with %d slides", job_id, slide_count)
                        urls: list[str] = []
                        slide_failures = 0
                        for i in range(slide_count):
                            slide_desc = slides[i] if i < len(slides) and slides[i] else None
                            slide_brief = ad.brief
                            if i < len(carousel_theme) and carousel_theme[i]:
                                override = carousel_theme[i]
                                slide_brief = dict(ad.brief)
                                if override.get("env") is not None:
                                    slide_brief["env"] = override["env"]
                                if override.get("image_scene") is not None:
                                    slide_brief["image_scene"] = override["image_scene"]
                                if override.get("text_overlay") is not None:
                                    slide_brief["text_overlay"] = override["text_overlay"]
                            img_prompt = _image_prompt(slide_brief, slide_desc)
                            logger.info(
                                "[image_prompt] job=%s carousel slide=%d/%d\n----- PROMPT START -----\n%s\n----- PROMPT END -----",
                                job_id, i + 1, slide_count, img_prompt,
                            )
                            try:
                                slide_bytes, slide_ext = generate_image(img_prompt, image_model_used, reference_urls=ref_urls)
                                if logo_bytes:
                                    slide_bytes = composite_logo(slide_bytes, logo_bytes, placement)
                                    slide_ext = "png"
                                slide_url = storage.upload_bytes(slide_bytes, f"image/{slide_ext}", slide_ext)
                                urls.append(slide_url)
                            except Exception as slide_exc:  # noqa: BLE001
                                slide_failures += 1
                                logger.warning("[carousel] job=%s slide %d/%d failed: %s", job_id, i + 1, slide_count, slide_exc)
                        if not urls:
                            raise RuntimeError(f"all {slide_count} carousel images failed to generate")
                        if slide_failures:
                            job.error = f"Copy OK, {slide_failures} of {slide_count} carousel image(s) failed to generate — showing the {len(urls)} that succeeded"[:1000]
                        for v in new_results["variants"]:
                            v["image_url"] = urls[0]  # first slide as the primary/fallback image for single-image consumers
                            v["image_urls"] = urls
                    else:
                        if ad.brief.get("image_prompt_override"):
                            img_prompt = ad.brief["image_prompt_override"]
                            logger.info("[image_prompt] job=%s USING OVERRIDE from confirmation popup", job_id)
                        else:
                            img_prompt = _image_prompt(ad.brief)
                        logger.info(
                            "[image_prompt] job=%s has_reference=%s\n----- PROMPT START -----\n%s\n----- PROMPT END -----",
                            job_id, bool(ref_urls), img_prompt,
                        )
                        try:
                            img_bytes, ext = generate_image(img_prompt, image_model_used, reference_urls=ref_urls)
                        except Exception as ref_exc:  # noqa: BLE001
                            if ref_urls:
                                # Tagged (not auto-retried) — the frontend
                                # detects this marker and asks the user
                                # explicitly whether to retry without the
                                # reference photo, rather than silently
                                # substituting a different generation than
                                # what they asked for.
                                raise RuntimeError(f"REFERENCE_REJECTED::{ref_exc}") from ref_exc
                            raise
                        if logo_bytes:
                            img_bytes = composite_logo(img_bytes, logo_bytes, placement)
                            ext = "png"
                            logger.info("[branding] job=%s composited logo at %s", job_id, placement)
                        url = storage.upload_bytes(img_bytes, f"image/{ext}", ext)
                        for v in new_results["variants"]:
                            v["image_url"] = url

                        # Same reframe pass as video, same reasoning —
                        # one AI generation, however many platform-ready
                        # versions are needed, via local Pillow compute
                        # instead of paying for another AI generation.
                        # Scoped to the single/primary image for now, not
                        # carousel slides — carousels are a bigger,
                        # separate piece (each slide would need its own
                        # reframe set) not built in this round.
                        try:
                            brand_kit = db.scalar(select(BrandKit).where(BrandKit.company_id == ad.company_id))
                            platform_ratios = get_ad_targeting_ratios_sync(db)
                            if brand_kit is not None and brand_kit.platform_ratio_overrides:
                                platform_ratios = {**platform_ratios, **brand_kit.platform_ratio_overrides}
                            available_ratios = get_video_ratios_sync(db)
                            needed_ratios = {resolve_ratio(platform_ratios[p], available_ratios) for p in (ad.platforms or []) if p in platform_ratios}
                            if needed_ratios and brand_kit is not None:
                                reframed_img_by_ratio: dict[str, str] = {}
                                for ratio in needed_ratios:
                                    try:
                                        reframed_img_bytes = reframe_image(url, ratio, brand_kit)
                                        reframed_img_by_ratio[ratio] = storage.upload_bytes(reframed_img_bytes, "image/png", "png")
                                        logger.info("[reframe] job=%s produced %s image version, url=%s", job_id, ratio, reframed_img_by_ratio[ratio])
                                    except Exception as exc:  # noqa: BLE001
                                        logger.warning("[reframe] job=%s failed to produce %s image version: %s", job_id, ratio, exc)
                                if reframed_img_by_ratio:
                                    platform_image_urls = {p: reframed_img_by_ratio[platform_ratios[p]] for p in (ad.platforms or []) if p in platform_ratios and platform_ratios[p] in reframed_img_by_ratio}
                                    for v in new_results["variants"]:
                                        v["platform_image_urls"] = platform_image_urls
                        except Exception as exc:  # noqa: BLE001
                            logger.warning("[reframe] job=%s image reframe pass failed entirely, master image unaffected: %s", job_id, exc)
                    models_used.append(image_model_used)
                except Exception as img_exc:  # noqa: BLE001
                    job.error = f"Copy OK, image generation failed: {img_exc}"[:1000]
                    if "REFERENCE_REJECTED::" in str(img_exc):
                        # Nothing was actually generated — refund just the
                        # image portion (not the whole job's cost, since
                        # text still succeeded) so the confirmation prompt
                        # offered to the user is telling the truth when it
                        # says this attempt cost nothing.
                        refund = ad.brief.get("image_model_credits") or 0
                        if refund > 0:
                            db.add(CreditLedger(company_id=job.company_id, delta=refund, reason="refund", ref_id=str(ad.id)))

            if not feedback and ad.outputs.get("video"):
                try:
                    shots = ad.brief.get("video_shots") or []
                    if not shots:
                        # Defensive fallback — shouldn't happen given the
                        # frontend always sends at least one shot, but
                        # avoids a hard crash if it ever does.
                        shots = [{"prompt": None, "duration": 6}]

                    frame_image_url = None
                    if not skip_reference and ad.brief.get("video_frame_image_url"):
                        # Deliberately a SEPARATE, explicit field from
                        # product_image_url (used for image generation) —
                        # what's used as the video's starting frame is
                        # now always exactly what was attached in the
                        # video section of Step 2, never an implicit
                        # reuse of the general product photo.
                        frame_image_url = storage.fetch_as_data_url(ad.brief["video_frame_image_url"])

                    # Two background quality steps, both developer-
                    # configured, neither customer-facing or customer-
                    # charged (see services/video_prep.py) — run BEFORE
                    # the main video prompt is built, so both feed into
                    # it rather than happening alongside it. Shot review
                    # specifically is opt-in per-ad now (refine_video_prompt) —
                    # a configured review model doesn't mean it's always
                    # applied; the customer decides per generation.
                    prep_settings = get_video_prep_settings_sync(db)
                    if ad.brief.get("refine_video_prompt") and prep_settings.get("prompt_review_model_id"):
                        review_models = get_available_models_sync(db)
                        review_entry = next((m for m in review_models.get("text", []) if m["id"] == prep_settings["prompt_review_model_id"]), None)
                        if review_entry:
                            for shot in shots:
                                if shot.get("prompt"):
                                    shot["prompt"] = _review_shot_prompt(shot["prompt"], review_entry["model"])
                            logger.info("[video_prep] job=%s reviewed %d shot prompt(s) with %s", job_id, len(shots), review_entry["model"])

                    # THE actual fix for the "first frames show the
                    # original reference photo's background, not the
                    # described scene" problem — render a NEW first
                    # frame that already matches shot 1's description.
                    # Two conditions now, not one: only in single_reference
                    # mode (in first_last_frame mode, both images are
                    # DELIBERATELY chosen compositions the customer picked
                    # on purpose — reinterpreting them would be actively
                    # wrong, not just unnecessary), and only when the
                    # customer opted in via refine_video_frame (changing
                    # someone's uploaded photo isn't always wanted, same
                    # reasoning as making prompt review opt-in).
                    if frame_image_url and ad.brief.get("video_mode", "single_reference") == "single_reference" and ad.brief.get("refine_video_frame") and prep_settings.get("image_model_id"):
                        prep_models = get_available_models_sync(db)
                        prep_entry = next((m for m in prep_models.get("image", []) if m["id"] == prep_settings["image_model_id"]), None)
                        first_shot_desc = (shots[0].get("prompt") or "").strip() if shots else ""
                        if prep_entry and first_shot_desc:
                            try:
                                product_name = ad.brief.get("product_name", "the product")
                                prep_prompt = _video_frame_prep_prompt(product_name, first_shot_desc)
                                logger.info("[video_prep] job=%s pre-rendering first frame with %s\n----- PREP PROMPT -----\n%s", job_id, prep_entry["model"], prep_prompt)
                                prep_bytes, prep_ext = generate_image(prep_prompt, prep_entry["model"], reference_urls=[frame_image_url])
                                prepped_url = storage.upload_bytes(prep_bytes, f"image/{prep_ext}", prep_ext)
                                frame_image_url = storage.fetch_as_data_url(prepped_url)
                                logger.info("[video_prep] job=%s first frame pre-rendered successfully, url=%s", job_id, prepped_url)
                            except Exception as exc:  # noqa: BLE001
                                # A prep failure should never block the
                                # actual video — fall back to the raw
                                # reference photo exactly as before this
                                # feature existed.
                                logger.warning("[video_prep] job=%s first-frame pre-render failed, using original reference: %s", job_id, exc)

                    # first_last_frame mode: the customer explicitly chose
                    # both images as intentional starting/ending
                    # compositions — used exactly as uploaded, never
                    # pre-rendered or reinterpreted.
                    end_frame_image_url = None
                    if not skip_reference and ad.brief.get("video_mode") == "first_last_frame" and ad.brief.get("video_end_frame_image_url"):
                        end_frame_image_url = storage.fetch_as_data_url(ad.brief["video_end_frame_image_url"])

                    video_model = ad.brief.get("video_model") or "alibaba/wan-2.7"  # resolved once at ad-creation time (ads.py), not re-looked-up here
                    video_resolution = ad.brief.get("video_resolution") or "720p"
                    video_audio = ad.brief.get("video_audio")  # None means "let OpenRouter use the model's own default" — only set when the customer actually had an audio toggle to choose from
                    total_duration = sum(s.get("duration") or 0 for s in shots) or 6

                    # The confirmation popup's edited/reviewed prompt is
                    # now used directly regardless of shot count — it
                    # already reflects shot review (if configured) and
                    # any manual edits the customer made, so there's no
                    # reason to rebuild from the raw shots and
                    # potentially re-review them a second time,
                    # producing a DIFFERENT result than what was actually
                    # confirmed.
                    if ad.brief.get("video_prompt_override"):
                        video_prompt = ad.brief["video_prompt_override"]
                        logger.info("[video_prompt] job=%s USING OVERRIDE from confirmation popup", job_id)
                    else:
                        video_prompt = _multi_shot_video_prompt(ad.brief, shots)
                    logger.info(
                        "[video_prompt] job=%s shots=%d total_duration=%ds\n----- PROMPT START -----\n%s\n----- PROMPT END -----",
                        job_id, len(shots), total_duration, video_prompt,
                    )

                    try:
                        video_bytes = generate_video(video_prompt, video_model, duration=total_duration, resolution=video_resolution, frame_image_url=frame_image_url, end_frame_image_url=end_frame_image_url, audio=video_audio)
                    except Exception as frame_exc:  # noqa: BLE001
                        if frame_image_url:
                            # Tagged (not auto-retried) — the frontend
                            # detects this marker and asks the user
                            # explicitly whether to retry without the
                            # reference photo, rather than silently
                            # substituting a different generation than
                            # what they asked for.
                            raise RuntimeError(f"REFERENCE_REJECTED::{frame_exc}") from frame_exc
                        raise
                    video_url = storage.upload_bytes(video_bytes, "video/mp4", "mp4")
                    video_url = _stitch_intro_outro(db, ad.brief, ad.company_id, video_url, f"job={job_id}")
                    for v in new_results["variants"]:
                        v["video_url"] = video_url

                    # Reframe pass — one FFmpeg run per DISTINCT ratio
                    # actually needed by this ad's selected platforms
                    # (not per platform; e.g. Facebook and LinkedIn share
                    # 1.91:1, so that's one reframe serving both), never
                    # per-model-generation, keeping AI generation cost
                    # exactly what it was regardless of how many
                    # platforms are targeted. See services/reframe.py.
                    try:
                        brand_kit = db.scalar(select(BrandKit).where(BrandKit.company_id == ad.company_id))
                        platform_ratios = get_ad_targeting_ratios_sync(db)
                        if brand_kit is not None and brand_kit.platform_ratio_overrides:
                            # Company's own override wins over the
                            # developer's platform-wide default —
                            # merged in, not replacing the whole map, so
                            # any platform the company HASN'T overridden
                            # still falls back to the default correctly.
                            platform_ratios = {**platform_ratios, **brand_kit.platform_ratio_overrides}
                        # Silently falls back to a default for any ratio
                        # that no longer exists in the developer's
                        # current list (e.g. deleted after a platform or
                        # company override was set to it) — never breaks
                        # generation over a stale reference.
                        available_ratios = get_video_ratios_sync(db)
                        needed_ratios = {resolve_ratio(platform_ratios[p], available_ratios) for p in (ad.platforms or []) if p in platform_ratios}
                        if needed_ratios:
                            if brand_kit is not None:
                                reframed_by_ratio: dict[str, str] = {}
                                for ratio in needed_ratios:
                                    try:
                                        reframed_bytes = reframe_video(video_url, ratio, brand_kit)
                                        reframed_by_ratio[ratio] = storage.upload_bytes(reframed_bytes, "video/mp4", "mp4")
                                        logger.info("[reframe] job=%s produced %s version, url=%s", job_id, ratio, reframed_by_ratio[ratio])
                                    except Exception as exc:  # noqa: BLE001
                                        # One ratio failing shouldn't lose
                                        # the others, or the master video
                                        # itself — this is a nice-to-have
                                        # layer on top of a generation
                                        # that already succeeded.
                                        logger.warning("[reframe] job=%s failed to produce %s version: %s", job_id, ratio, exc)
                                if reframed_by_ratio:
                                    platform_video_urls = {p: reframed_by_ratio[platform_ratios[p]] for p in (ad.platforms or []) if p in platform_ratios and platform_ratios[p] in reframed_by_ratio}
                                    for v in new_results["variants"]:
                                        v["platform_video_urls"] = platform_video_urls
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("[reframe] job=%s reframe pass failed entirely, master video unaffected: %s", job_id, exc)

                    models_used.append(video_model)
                except Exception as vid_exc:  # noqa: BLE001
                    existing_err = job.error or "Copy OK"
                    job.error = f"{existing_err}, video generation failed: {vid_exc}"[:1000]
                    if "REFERENCE_REJECTED::" in str(vid_exc):
                        refund = ad.brief.get("video_model_credits") or 0
                        if refund > 0:
                            db.add(CreditLedger(company_id=job.company_id, delta=refund, reason="refund", ref_id=str(ad.id)))

            ad.results = new_results
            flag_modified(ad, "results")  # explicit, reliable — same fix as the campaign-image bug found and confirmed
            ad.status = "ready"
            job.status = "done"
            job.model_used = " + ".join(models_used)[:120]
            job.finished_at = datetime.utcnow()
            db.commit()
            return "ok"

        except Exception as exc:  # noqa: BLE001
            job.status = "failed"
            job.error = str(exc)[:1000]
            job.finished_at = datetime.utcnow()
            ad.status = "failed"
            if job.credits_cost > 0:
                db.add(CreditLedger(
                    company_id=job.company_id, delta=job.credits_cost,
                    reason="refund", ref_id=str(ad.id),
                ))
            db.commit()
            return f"failed: {exc}"


@celery_app.task(name="app.edit_ad_image", bind=True, max_retries=0)
def edit_ad_image(self, job_id: str, feedback: str, variant: int = 0):
    """Edits the ALREADY-GENERATED image based on customer feedback (e.g.
    "make the background brighter", "zoom out so the whole bottle is
    visible") — uses the CURRENT image as the reference for a true
    iterative edit, not the original product photo. Leaves the copy
    untouched; only the shared image_url is updated."""
    with Session(sync_engine) as db:
        job = db.get(GenerationJob, job_id)
        if job is None:
            return "job not found"
        ad = db.get(Ad, job.ad_id)
        job.status = "running"
        db.commit()

        try:
            results = ad.results or {"variants": [{}]}
            variants = list(results.get("variants", [{}]))
            idx = min(max(variant, 0), len(variants) - 1)
            current_image_url = variants[idx].get("image_url")
            if not current_image_url:
                raise RuntimeError("No existing image to edit — generate an image first.")

            image_model = ad.brief.get("image_model") or "google/gemini-2.5-flash-image"  # reuse the SAME model this ad/phase was originally generated with, not a re-lookup

            product = ad.brief.get("product_name", "the product")
            edit_prompt = (
                f"You are given a reference photo — the current advertising image for \"{product}\". "
                f"Make ONLY this specific change, keeping everything else in the image the same: {feedback}\n"
                "Keep the product itself, its position, and the overall composition consistent with the "
                "reference unless the requested change specifically requires otherwise. "
                "The ENTIRE product must remain fully visible with clear margin on all sides — do not crop it. "
                "High-end commercial ad photography style, sharp focus, no text overlay, no watermark."
            )
            logger.info(
                "[image_edit] job=%s variant=%s feedback=%r\n----- PROMPT START -----\n%s\n----- PROMPT END -----",
                job_id, idx, feedback, edit_prompt,
            )

            ref_data_url = storage.fetch_as_data_url(current_image_url)
            img_bytes, ext = generate_image(edit_prompt, image_model, reference_urls=[ref_data_url])

            logo_url = ad.brief.get("brand_logo_url")
            if logo_url:
                try:
                    logo_bytes, _ = storage.fetch_bytes(logo_url)
                    placement = ad.brief.get("brand_logo_placement") or "bottom-right"
                    img_bytes = composite_logo(img_bytes, logo_bytes, placement)
                    ext = "png"
                except Exception as brand_exc:  # noqa: BLE001
                    logger.warning("[branding] job=%s re-composite after edit failed: %s", job_id, brand_exc)

            new_url = storage.upload_bytes(img_bytes, f"image/{ext}", ext)
            for v in variants:
                v["image_url"] = new_url  # shared image across platforms, same as initial generation
            ad.results = {"variants": variants}
            flag_modified(ad, "results")  # explicit, reliable — same fix as the campaign-image bug found and confirmed
            ad.status = "ready"
            job.status = "done"
            job.model_used = image_model
            job.finished_at = datetime.utcnow()
            db.commit()
            return "ok"

        except Exception as exc:  # noqa: BLE001
            job.status = "failed"
            job.error = str(exc)[:1000]
            job.finished_at = datetime.utcnow()
            if ad.status != "ready":
                ad.status = "ready"  # keep the ad usable even if the edit failed
            if job.credits_cost > 0:
                db.add(CreditLedger(
                    company_id=job.company_id, delta=job.credits_cost,
                    reason="refund", ref_id=str(ad.id),
                ))
            db.commit()
            return f"failed: {exc}"


@celery_app.task(name="app.generate_campaign_ad_image", bind=True, max_retries=0)
def generate_campaign_ad_image(self, job_id: str, skip_reference: bool = False):
    """Generates the image and/or video for an ad created from a campaign
    phase — the copy is already the phase's caption (set directly at ad
    creation, no Claude call needed for that part). Video uses the exact
    same multi-shot combined-prompt approach and automatic image-to-video
    fallback as Create Ad's generate_ad task (see tasks.py's
    _multi_shot_video_prompt) — kept as a separate task (not reusing
    generate_ad wholesale) since campaign phase ads never need the text-
    generation branch, but the underlying video/image logic is shared,
    not reimplemented."""
    with Session(sync_engine) as db:
        job = db.get(GenerationJob, job_id)
        if job is None:
            return "job not found"
        ad = db.get(Ad, job.ad_id)
        job.status = "running"
        db.commit()

        results = ad.results or {"variants": [{}]}
        variants = list(results.get("variants", [{}]))
        models_used = []
        job_error = None

        if ad.outputs.get("image"):
            try:
                img_prompt = _image_prompt(ad.brief)
                image_model = ad.brief.get("image_model") or "google/gemini-2.5-flash-image"  # reuse the SAME model this ad/phase was originally generated with, not a re-lookup
                ref_urls = None
                image_ref_url = None if skip_reference else (ad.brief.get("image_reference_image_url") or ad.brief.get("product_image_url"))
                if image_ref_url:
                    data_url = storage.fetch_as_data_url(image_ref_url)
                    ref_urls = [data_url]
                logger.info(
                    "[image_prompt] job=%s (campaign ad) has_reference=%s\n----- PROMPT START -----\n%s\n----- PROMPT END -----",
                    job_id, bool(ref_urls), img_prompt,
                )
                try:
                    img_bytes, ext = generate_image(img_prompt, image_model, reference_urls=ref_urls)
                except Exception as ref_exc:  # noqa: BLE001
                    if ref_urls:
                        raise RuntimeError(f"REFERENCE_REJECTED::{ref_exc}") from ref_exc
                    raise

                logo_url = ad.brief.get("brand_logo_url")
                if logo_url:
                    try:
                        logo_bytes, _ = storage.fetch_bytes(logo_url)
                        placement = ad.brief.get("brand_logo_placement") or "bottom-right"
                        img_bytes = composite_logo(img_bytes, logo_bytes, placement)
                        ext = "png"
                    except Exception as brand_exc:  # noqa: BLE001
                        logger.warning("[branding] job=%s logo compositing failed: %s", job_id, brand_exc)

                url = storage.upload_bytes(img_bytes, f"image/{ext}", ext)
                logger.info("[campaign_image] job=%s uploaded image, url=%s", job_id, url)
                for v in variants:
                    v["image_url"] = url

                # Same image reframe pass as generate_ad — see the
                # detailed comment there.
                try:
                    brand_kit = db.scalar(select(BrandKit).where(BrandKit.company_id == ad.company_id))
                    platform_ratios = get_ad_targeting_ratios_sync(db)
                    if brand_kit is not None and brand_kit.platform_ratio_overrides:
                        platform_ratios = {**platform_ratios, **brand_kit.platform_ratio_overrides}
                    available_ratios = get_video_ratios_sync(db)
                    needed_ratios = {resolve_ratio(platform_ratios[p], available_ratios) for p in (ad.platforms or []) if p in platform_ratios}
                    if needed_ratios and brand_kit is not None:
                        reframed_img_by_ratio: dict[str, str] = {}
                        for ratio in needed_ratios:
                            try:
                                reframed_img_bytes = reframe_image(url, ratio, brand_kit)
                                reframed_img_by_ratio[ratio] = storage.upload_bytes(reframed_img_bytes, "image/png", "png")
                                logger.info("[reframe] job=%s (campaign ad) produced %s image version", job_id, ratio)
                            except Exception as exc:  # noqa: BLE001
                                logger.warning("[reframe] job=%s (campaign ad) failed to produce %s image version: %s", job_id, ratio, exc)
                        if reframed_img_by_ratio:
                            platform_image_urls = {p: reframed_img_by_ratio[platform_ratios[p]] for p in (ad.platforms or []) if p in platform_ratios and platform_ratios[p] in reframed_img_by_ratio}
                            for v in variants:
                                v["platform_image_urls"] = platform_image_urls
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[reframe] job=%s (campaign ad) image reframe pass failed entirely, master image unaffected: %s", job_id, exc)

                models_used.append(image_model)
            except Exception as exc:  # noqa: BLE001
                job_error = f"image generation failed: {exc}"[:500]

        if ad.outputs.get("video"):
            try:
                shots = ad.brief.get("video_shots") or [{"prompt": None, "duration": 6}]
                frame_image_url = None
                if not skip_reference and ad.brief.get("video_frame_image_url"):
                    frame_image_url = storage.fetch_as_data_url(ad.brief["video_frame_image_url"])

                # Same two background quality steps as generate_ad — see
                # services/video_prep.py and the detailed comments there.
                # Shot review is opt-in per-ad (refine_video_prompt) —
                # same as Create Ad, not automatic just because a review
                # model is configured.
                prep_settings = get_video_prep_settings_sync(db)
                if ad.brief.get("refine_video_prompt") and prep_settings.get("prompt_review_model_id"):
                    review_models = get_available_models_sync(db)
                    review_entry = next((m for m in review_models.get("text", []) if m["id"] == prep_settings["prompt_review_model_id"]), None)
                    if review_entry:
                        for shot in shots:
                            if shot.get("prompt"):
                                shot["prompt"] = _review_shot_prompt(shot["prompt"], review_entry["model"])

                # Same conditions as generate_ad: only single_reference
                # mode, only when the customer opted in — never in
                # first_last_frame mode (deliberately chosen compositions).
                if frame_image_url and ad.brief.get("video_mode", "single_reference") == "single_reference" and ad.brief.get("refine_video_frame") and prep_settings.get("image_model_id"):
                    prep_models = get_available_models_sync(db)
                    prep_entry = next((m for m in prep_models.get("image", []) if m["id"] == prep_settings["image_model_id"]), None)
                    first_shot_desc = (shots[0].get("prompt") or "").strip() if shots else ""
                    if prep_entry and first_shot_desc:
                        try:
                            product_name = ad.brief.get("product_name", "the product")
                            prep_prompt = _video_frame_prep_prompt(product_name, first_shot_desc)
                            prep_bytes, prep_ext = generate_image(prep_prompt, prep_entry["model"], reference_urls=[frame_image_url])
                            prepped_url = storage.upload_bytes(prep_bytes, f"image/{prep_ext}", prep_ext)
                            frame_image_url = storage.fetch_as_data_url(prepped_url)
                            logger.info("[video_prep] job=%s (campaign ad) first frame pre-rendered with %s", job_id, prep_entry["model"])
                        except Exception as exc:  # noqa: BLE001
                            logger.warning("[video_prep] job=%s (campaign ad) first-frame pre-render failed, using original reference: %s", job_id, exc)

                # Start + end frame mode — the customer explicitly chose
                # both images as intentional compositions, used exactly
                # as uploaded, never pre-rendered or reinterpreted.
                end_frame_image_url = None
                if not skip_reference and ad.brief.get("video_mode") == "first_last_frame" and ad.brief.get("video_end_frame_image_url"):
                    end_frame_image_url = storage.fetch_as_data_url(ad.brief["video_end_frame_image_url"])

                video_model = ad.brief.get("video_model") or "alibaba/wan-2.7"
                video_resolution = ad.brief.get("video_resolution") or "720p"
                video_audio = ad.brief.get("video_audio")
                total_duration = sum(s.get("duration") or 0 for s in shots) or 6

                if ad.brief.get("video_prompt_override"):
                    video_prompt = ad.brief["video_prompt_override"]
                else:
                    video_prompt = _multi_shot_video_prompt(ad.brief, shots)
                logger.info(
                    "[video_prompt] job=%s (campaign ad) shots=%d total_duration=%ds\n----- PROMPT START -----\n%s\n----- PROMPT END -----",
                    job_id, len(shots), total_duration, video_prompt,
                )

                try:
                    video_bytes = generate_video(video_prompt, video_model, duration=total_duration, resolution=video_resolution, frame_image_url=frame_image_url, end_frame_image_url=end_frame_image_url, audio=video_audio)
                except Exception as frame_exc:  # noqa: BLE001
                    if frame_image_url:
                        raise RuntimeError(f"REFERENCE_REJECTED::{frame_exc}") from frame_exc
                    raise

                video_url = storage.upload_bytes(video_bytes, "video/mp4", "mp4")
                video_url = _stitch_intro_outro(db, ad.brief, ad.company_id, video_url, f"job={job_id}")
                logger.info("[campaign_video] job=%s uploaded video, url=%s", job_id, video_url)
                for v in variants:
                    v["video_url"] = video_url

                # Same reframe pass as generate_ad — see the detailed
                # comment there.
                try:
                    brand_kit = db.scalar(select(BrandKit).where(BrandKit.company_id == ad.company_id))
                    platform_ratios = get_ad_targeting_ratios_sync(db)
                    if brand_kit is not None and brand_kit.platform_ratio_overrides:
                        platform_ratios = {**platform_ratios, **brand_kit.platform_ratio_overrides}
                    available_ratios = get_video_ratios_sync(db)
                    needed_ratios = {resolve_ratio(platform_ratios[p], available_ratios) for p in (ad.platforms or []) if p in platform_ratios}
                    if needed_ratios:
                        if brand_kit is not None:
                            reframed_by_ratio: dict[str, str] = {}
                            for ratio in needed_ratios:
                                try:
                                    reframed_bytes = reframe_video(video_url, ratio, brand_kit)
                                    reframed_by_ratio[ratio] = storage.upload_bytes(reframed_bytes, "video/mp4", "mp4")
                                    logger.info("[reframe] job=%s (campaign ad) produced %s version", job_id, ratio)
                                except Exception as exc:  # noqa: BLE001
                                    logger.warning("[reframe] job=%s (campaign ad) failed to produce %s version: %s", job_id, ratio, exc)
                            if reframed_by_ratio:
                                platform_video_urls = {p: reframed_by_ratio[platform_ratios[p]] for p in (ad.platforms or []) if p in platform_ratios and platform_ratios[p] in reframed_by_ratio}
                                for v in variants:
                                    v["platform_video_urls"] = platform_video_urls
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[reframe] job=%s (campaign ad) reframe pass failed entirely, master video unaffected: %s", job_id, exc)

                models_used.append(video_model)
            except Exception as exc:  # noqa: BLE001
                job_error = f"{job_error + ', ' if job_error else ''}video generation failed: {exc}"[:1000]

        ad.results = {"variants": variants}
        flag_modified(ad, "results")  # explicit, reliable — don't rely on SQLAlchemy noticing this JSON column changed

        ad.status = "ready"
        job.status = "failed" if job_error and not models_used else "done"
        job.error = job_error
        job.model_used = " + ".join(models_used)[:120] if models_used else None
        job.finished_at = datetime.utcnow()
        if job_error and not models_used and job.credits_cost > 0:
            # Total failure (nothing generated at all) — refund. A
            # partial failure (e.g. image worked, video didn't) keeps
            # the charge, matching generate_ad's own behavior.
            db.add(CreditLedger(company_id=job.company_id, delta=job.credits_cost, reason="refund", ref_id=str(ad.id)))
        db.commit()

        # Lightweight permanent confirmation that the write actually landed
        # (re-reads fresh from the database, not just Python's in-memory copy).
        db.expire_all()
        confirm = db.get(Ad, ad.id)
        confirmed_variant = (confirm.results or {}).get("variants", [{}])[0] if confirm and confirm.results else {}
        logger.info(
            "[campaign_ad] job=%s persisted image=%s video=%s",
            job_id, bool(confirmed_variant.get("image_url")), bool(confirmed_variant.get("video_url")),
        )

        return "ok" if models_used else f"failed: {job_error}"


@celery_app.task(name="app.fire_due_scheduled_posts")
def fire_due_scheduled_posts():
    """Celery Beat periodic task: finds scheduled posts whose time has come
    and posts them. For platforms with a real, connected integration
    (currently just LinkedIn — see services/linkedin.py) and
    MOCK_POSTING=False, this actually publishes; a failed real post is
    marked "failed" (not "posted") and left for the customer to retry
    manually from My Ads, rather than silently pretending it went out.
    Everything else still uses the same honest simulated-posting
    behavior the app has always had."""
    with Session(sync_engine) as db:
        due = db.scalars(
            select(ScheduledPost).where(
                ScheduledPost.status == "pending",
                ScheduledPost.scheduled_at <= datetime.utcnow(),
            )
        ).all()
        if not due:
            return "nothing due"

        posted_count = 0
        failed_count = 0
        for sp in due:
            ad = db.get(Ad, sp.ad_id)
            if sp.platform == "linkedin" and not settings.MOCK_POSTING:
                conn = db.scalar(select(PlatformConnection).where(
                    PlatformConnection.company_id == sp.company_id, PlatformConnection.platform == "linkedin",
                ))
                if not (conn and conn.status == "connected"):
                    sp.status = "failed"
                    failed_count += 1
                    continue
                try:
                    access_token = decrypt_token(conn.encrypted_token)
                    person_urn = linkedin.get_person_urn(access_token)
                    variant = (ad.results or {}).get("variants", [{}])[0] if ad and ad.results else {}
                    caption = (variant.get("linkedin") or {}).get("caption") or ""
                    linkedin.post_to_linkedin(access_token, person_urn, caption)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[schedule] scheduled_post=%s LinkedIn post failed: %s", sp.id, exc)
                    sp.status = "failed"
                    failed_count += 1
                    continue

            sp.status = "posted"
            sp.posted_at = datetime.utcnow()
            if ad:
                current = set(ad.posted_platforms or [])
                current.add(sp.platform)
                ad.posted_platforms = list(current)
                flag_modified(ad, "posted_platforms")
                if ad.posted_at is None:
                    ad.posted_at = sp.posted_at
                ad.status = "posted"
            posted_count += 1
        db.commit()
        return f"posted {posted_count}, failed {failed_count}"


@celery_app.task(name="app.cleanup_expired_media")
def cleanup_expired_media():
    """Daily retention cleanup (see services/retention.py) — Option B,
    agreed with the developer: deletes the actual image/video FILES
    from storage and clears their URLs from the ad's results, but never
    deletes the Ad row itself — caption, metadata, and analytics data
    stay forever. Batched (BATCH_SIZE per run) so a large backlog
    doesn't lock up the database in one giant transaction; if a batch
    is full, the next Beat run (the following day) picks up where this
    one left off.

    The "pending scheduled post" skip is a defensive backstop, not the
    primary protection — the primary protection is that scheduling is
    capped at each ad's own created_at + retention period (see
    schedule.py/campaigns.py), which makes a still-pending post outliving
    its ad's retention window essentially impossible by construction.
    This check just guards against edge cases like the developer
    shortening the retention period after a post was already scheduled
    under a longer one."""
    BATCH_SIZE = 200
    with Session(sync_engine) as db:
        months = get_retention_months_sync(db)
        cutoff = datetime.utcnow() - timedelta(days=months * 30)  # approximate months as 30-day blocks — consistent with how the scheduling cap computes the same cutoff, so the two never disagree

        candidates = db.scalars(
            select(Ad).where(
                Ad.created_at < cutoff,
                Ad.results.isnot(None),
            ).limit(BATCH_SIZE * 3)  # over-fetch since some will be skipped (already clean, or have a pending post) — avoids an extra query round-trip for the common case
        ).all()

        cleaned = 0
        skipped_pending = 0
        for ad in candidates:
            if cleaned >= BATCH_SIZE:
                break
            variants = (ad.results or {}).get("variants") or []
            has_media = any(v.get("image_url") or v.get("video_url") or v.get("image_urls") for v in variants)
            if not has_media:
                continue

            still_pending = db.scalar(
                select(func.count()).select_from(ScheduledPost).where(
                    ScheduledPost.ad_id == ad.id, ScheduledPost.status == "pending",
                )
            )
            if still_pending:
                skipped_pending += 1
                continue

            for v in variants:
                for url in ([v["image_url"]] if v.get("image_url") else []) + ([v["video_url"]] if v.get("video_url") else []) + (v.get("image_urls") or []):
                    try:
                        storage.delete_object(url)
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("[retention] ad=%s failed to delete object %s: %s", ad.id, url, exc)
                v.pop("image_url", None)
                v.pop("video_url", None)
                v.pop("image_urls", None)
            ad.results = {"variants": variants}
            flag_modified(ad, "results")
            cleaned += 1

        db.commit()
        logger.info("[retention] cleaned=%d skipped_pending=%d cutoff=%s", cleaned, skipped_pending, cutoff.isoformat())
        return f"cleaned {cleaned}, skipped {skipped_pending} (pending post)"


@celery_app.task(name="app.cleanup_expired_posts")
def cleanup_expired_posts():
    """Daily cleanup of the AD RECORD ITSELF (see
    services/retention.py's post_retention_months) — separate from and
    much longer than media-only retention. Media cleanup (above) keeps
    the ad forever and only strips files; this is the actual bound on
    long-run database growth, deleting the whole row — caption,
    metadata, everything — once it's old enough. Default 24 months (2
    years), independently configurable from the 6-month media default.

    GenerationJob and ScheduledPost both have a real foreign key to
    ads.id with no cascade configured, so both must be deleted
    explicitly before the Ad row itself, or the delete would fail on a
    foreign key violation. FlaggedContent and AuditLog do NOT reference
    ads.id (only companies.id/users.id), so nothing else needs
    cleaning up here.

    Same defensive "pending scheduled post" skip as the media cleanup,
    even though at 2 years default it's an extreme edge case by the
    time it would ever matter — cheap insurance, same reasoning as
    before."""
    BATCH_SIZE = 200
    with Session(sync_engine) as db:
        months = get_post_retention_months_sync(db)
        cutoff = datetime.utcnow() - timedelta(days=months * 30)

        candidates = db.scalars(
            select(Ad).where(Ad.created_at < cutoff).limit(BATCH_SIZE * 2)
        ).all()

        deleted = 0
        skipped_pending = 0
        for ad in candidates:
            if deleted >= BATCH_SIZE:
                break
            still_pending = db.scalar(
                select(func.count()).select_from(ScheduledPost).where(
                    ScheduledPost.ad_id == ad.id, ScheduledPost.status == "pending",
                )
            )
            if still_pending:
                skipped_pending += 1
                continue

            db.execute(delete(ScheduledPost).where(ScheduledPost.ad_id == ad.id))
            db.execute(delete(GenerationJob).where(GenerationJob.ad_id == ad.id))
            db.delete(ad)
            deleted += 1

        db.commit()
        logger.info("[retention] posts deleted=%d skipped_pending=%d cutoff=%s", deleted, skipped_pending, cutoff.isoformat())
        return f"deleted {deleted} posts, skipped {skipped_pending} (pending post)"


def _resolve_default_text_and_image_models(db):
    """Picks the first enabled text/image model from the platform
    catalog — used for agent-generated ads (Quick Start + recurring
    events), which don't go through Create Ad's own model picker."""
    models = get_available_models_sync(db)
    text_models = [m for m in models.get("text", []) if m.get("enabled", True)]
    image_models = [m for m in models.get("image", []) if m.get("enabled", True)]
    if not text_models or not image_models:
        raise RuntimeError("No enabled text/image models configured — Agent Niva needs at least one of each to generate an ad.")
    return text_models[0], image_models[0]


@celery_app.task(name="app.generate_quick_start_recommendations", bind=True, max_retries=0)
def generate_quick_start_recommendations(self, job_id: str):
    """Scrapes the company's site (see services/agent_scraper.py — swap
    that module's implementation for a JS-capable scraper if needed)
    and asks a text model to recommend `count` concrete ad ideas from
    what it read, storing each as a pending AgentRecommendation for the
    customer to review (see routers/agent.py)."""
    with Session(sync_engine) as db:
        job = db.get(AgentScrapeJob, job_id)
        if job is None:
            return "job not found"
        job.status = "running"
        db.commit()
        try:
            # If content was pre-filled (from a saved ScrapedSite), skip the crawl
            if job.content:
                site_text = job.content
            else:
                site_text = scrape_company_website(job.url)
                job.content = site_text  # store so caller can save it as a ScrapedSite
                db.commit()
            text_models = [m for m in get_available_models_sync(db).get("text", []) if m.get("enabled", True)]
            if not text_models:
                raise RuntimeError("No enabled text model configured.")
            model = text_models[0]["model"]

            prompt = (
                f"You are a marketing strategist. Below is the visible text content scraped from a company's "
                f"website. Based ONLY on what's actually there (don't invent products or claims that aren't "
                f"implied by the content), recommend exactly {job.count} distinct, concrete social media ad ideas "
                f"this company could run.\n\n"
                + (
                    f"The customer has asked you to focus specifically on: \"{job.focus}\". "
                    f"All {job.count} ideas should be directly relevant to that subject — don't recommend unrelated angles.\n\n"
                    if job.focus else ""
                )
                + f"Respond with ONLY a JSON array (no markdown fences, no preamble), each item shaped exactly as:\n"
                f'{{"title": "short internal name for this ad idea", '
                f'"description": "2-3 sentence ad description/angle, written as if briefing a copywriter", '
                f'"audience": "who this ad should target — age range, interests, lifestyle in one short sentence", '
                f'"platforms": ["facebook","instagram"]}}\n'
                f'Valid platform values: facebook, instagram, linkedin, x, tiktok. Pick 1-3 sensible platforms per idea.\n\n'
                f"Website content:\n{site_text}"
            )
            parsed = text_gen.generate_text(prompt, model)
            ideas = parsed if isinstance(parsed, list) else parsed.get("ideas", [])
            if not ideas:
                raise RuntimeError("The model didn't return any ad ideas — try a different URL or fewer requested ads.")

            for idea in ideas[: job.count]:
                db.add(AgentRecommendation(
                    company_id=job.company_id, source_url=job.url, status="pending",
                    title=(idea.get("title") or "Untitled idea")[:200],
                    description=idea.get("description") or "",
                    audience=(idea.get("audience") or "")[:300],
                    platforms=[p for p in (idea.get("platforms") or []) if p in ("facebook", "instagram", "linkedin", "x", "tiktok")] or ["facebook", "instagram"],
                ))
            job.status = "ready"
            db.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("[agent] quick-start job=%s failed: %s", job_id, exc)
            job.status = "failed"
            job.error = str(exc)[:1000]
            db.commit()
        return "done"


def _create_agent_ad_sync(db, company_id, product_name: str, description: str, platforms: list[str], agent_source: str, agent_event_id=None, product_id=None) -> "Ad":
    """Builds and generates one ad directly from the Celery/sync world —
    used for BOTH recurring-event ads (no HTTP request in progress to
    hang this off) and can be reused wherever agent-triggered generation
    needs to happen outside a request. Deliberately simple compared to
    the full Create Ad flow: text + image only, platform's default
    models, no theme reference, no carousel, no video — Agent Niva's
    job is fast, reasonable ads from minimal input, not the full
    creative toolkit. Runs generate_ad's logic inline (direct call, not
    a separate enqueued task) since this already runs inside a worker."""
    text_model, image_model = _resolve_default_text_and_image_models(db)
    cost = (text_model.get("credits") or 0) + (image_model.get("credits") or 0)

    product = db.get(Product, product_id) if product_id else None
    ad = Ad(
        company_id=company_id, created_by=None, product_id=product_id,
        brief={
            "product_name": product_name, "description": description,
            "audience": "", "offer": "", "goal": "Drive sales", "tone": "Professional",
            "env": None, "image_scene": description, "product_image_url": product.image_url if product else None,
            "text_model": text_model["model"], "text_model_credits": text_model.get("credits"),
            "image_model": image_model["model"], "image_model_credits": image_model.get("credits"),
        },
        platforms=platforms, outputs={"text": True, "image": True, "video": False, "format": "single", "variations": 1},
        status="generating", agent_source=agent_source, agent_event_id=agent_event_id,
    )
    db.add(ad)
    db.flush()

    job = GenerationJob(company_id=company_id, ad_id=ad.id, kind="ad", credits_cost=cost)
    db.add(job)
    db.add(CreditLedger(company_id=company_id, delta=-cost, reason="generation", ref_id=str(ad.id)))
    db.commit()

    generate_ad(str(job.id))  # direct call, not .delay() — already running inside a worker process
    return ad


@celery_app.task(name="app.check_agent_events", bind=True, max_retries=0)
def check_agent_events(self):
    """Celery Beat, once daily at 5 AM UTC.

    Two-trigger flow per recurring event, per year:

    Trigger 1 — event_date minus lead_days (user-configured):
        Creates a DRAFT ad for all three approval modes.
        Notifies the user the draft is ready to review.

    Trigger 2 — event_date minus POST_WINDOW_DAYS (fixed at 7):
        Takes the draft (in whatever state the user left it) and:
        - draft_only      → keeps draft, notifies to schedule manually.
        - schedule_review → creates ScheduledPost status=review_required
                            (fire_due_scheduled_posts ignores this status).
                            Notifies user to approve before it posts.
        - auto_post       → creates ScheduledPost status=pending (will auto-post).
                            Sends advance warning notification.

    Trigger 3 — event_date minus 2 days (auto_post only):
        Final warning notification before the auto-post fires.

    draft_run_year tracks Trigger 1; last_run_year tracks Trigger 2.
    Both reset each year so the cycle repeats.
    """
    from app.models import Notification  # local import avoids circular at module level
    POST_WINDOW_DAYS = 7
    FINAL_WARN_DAYS  = 2

    with Session(sync_engine) as db:
        today  = date.today()
        events = db.scalars(select(AgentEvent).where(AgentEvent.enabled == True)).all()  # noqa: E712
        fired  = 0
        skipped_budget = 0

        for ev in events:
            year = today.year
            if year in (ev.skipped_years or []):
                continue
            try:
                event_date = date(year, ev.month, ev.day)
                draft_date = event_date - timedelta(days=ev.lead_days)
                post_date  = event_date - timedelta(days=POST_WINDOW_DAYS)
                warn_date  = event_date - timedelta(days=FINAL_WARN_DAYS)
            except ValueError:
                continue

            settings_      = get_agent_settings_sync(db, ev.company_id)
            budget_mode    = settings_.get("credit_cap_mode", "monthly_budget")
            monthly_budget = settings_.get("monthly_credit_budget", 200)
            mode           = ev.approval_mode or "draft_only"

            # ── Trigger 3: final auto_post warning (2 days before event) ──
            if mode == "auto_post" and today == warn_date and ev.last_run_year == year:
                db.add(Notification(
                    company_id=ev.company_id, type="agent_auto_posting_soon",
                    title=f"\u23f0 {ev.name} posts in {FINAL_WARN_DAYS} days",
                    body=f"Your Agent Niva ad for {ev.name} is scheduled to post automatically on {event_date.strftime('%b %d')}. Open My Ads or Calendar to make any last-minute changes.",
                    action_url="/app/calendar", dismissed_by=[],
                ))
                db.commit()
                continue

            # ── Trigger 2: draft → post (7 days before event) ─────────────
            if today == post_date and ev.draft_run_year == year and ev.last_run_year != year:
                draft_ad = db.scalar(
                    select(Ad).where(
                        Ad.company_id == ev.company_id,
                        Ad.agent_event_id == ev.id,
                        Ad.status == "draft",
                    ).order_by(Ad.created_at.desc())
                )
                if draft_ad is None:
                    logger.warning("[agent-events] event=%s Trigger 2: no draft found, skipping", ev.id)
                    continue

                scheduled_at = datetime.combine(event_date, datetime.min.time().replace(hour=10))

                if mode == "draft_only":
                    db.add(Notification(
                        company_id=ev.company_id, type="agent_draft_ready",
                        title=f"\U0001f4cb {ev.name} draft is ready to schedule",
                        body=f"Agent Niva has prepared your {ev.name} draft ({event_date.strftime('%b %d')}). Open My Ads to review and schedule it yourself.",
                        action_url="/app/my-ads", dismissed_by=[],
                    ))

                elif mode == "schedule_review":
                    for p in (draft_ad.platforms or ev.platforms or ["facebook", "instagram"]):
                        db.add(ScheduledPost(
                            company_id=ev.company_id, ad_id=draft_ad.id,
                            platform=p, scheduled_at=scheduled_at,
                            status="review_required",
                        ))
                    draft_ad.status = "scheduled"
                    db.add(Notification(
                        company_id=ev.company_id, type="agent_review_required",
                        title=f"\U0001f440 {ev.name} needs your approval before it posts",
                        body=f"The ad for {ev.name} is scheduled for {event_date.strftime('%b %d')} but won\'t post until you approve it. Open Calendar to review and confirm.",
                        action_url="/app/calendar", dismissed_by=[],
                    ))

                elif mode == "auto_post":
                    for p in (draft_ad.platforms or ev.platforms or ["facebook", "instagram"]):
                        db.add(ScheduledPost(
                            company_id=ev.company_id, ad_id=draft_ad.id,
                            platform=p, scheduled_at=scheduled_at,
                            status="pending",
                        ))
                    draft_ad.status = "scheduled"
                    db.add(Notification(
                        company_id=ev.company_id, type="agent_auto_posting_soon",
                        title=f"\U0001f916 {ev.name} ad scheduled — posts automatically on {event_date.strftime('%b %d')}",
                        body=f"Agent Niva has scheduled your {ev.name} ad to post automatically. You have {POST_WINDOW_DAYS} days to make changes in My Ads or Calendar.",
                        action_url="/app/calendar", dismissed_by=[],
                    ))

                ev.last_run_year = year
                db.commit()
                fired += 1
                continue

            # ── Trigger 1: create draft (lead_days before event) ───────────
            if today == draft_date and ev.draft_run_year != year:
                if budget_mode == "monthly_budget":
                    month_start = datetime(year, today.month, 1)
                    spent = db.scalar(
                        select(func.coalesce(func.sum(GenerationJob.credits_cost), 0))
                        .select_from(GenerationJob).join(Ad, Ad.id == GenerationJob.ad_id)
                        .where(Ad.company_id == ev.company_id, Ad.agent_source.isnot(None), GenerationJob.created_at >= month_start)
                    ) or 0
                    if spent >= monthly_budget:
                        logger.info("[agent-events] company=%s event=%s skipped — monthly budget reached", ev.company_id, ev.id)
                        skipped_budget += 1
                        ev.draft_run_year = year
                        db.commit()
                        continue

                try:
                    ad = _create_agent_ad_sync(
                        db, ev.company_id,
                        product_name=ev.name,
                        description=ev.guidance or f"An ad for {ev.name}",
                        platforms=ev.platforms or ["facebook", "instagram"],
                        agent_source="event", agent_event_id=ev.id, product_id=ev.product_id,
                    )
                    ad.status = "draft"
                    ev.draft_run_year = year
                    mode_msg = {
                        "draft_only":      f"Review it in My Ads and schedule it yourself before {event_date.strftime('%b %d')}.",
                        "schedule_review": f"Edit the draft anytime before {post_date.strftime('%b %d')} — that\'s when the post is generated from it.",
                        "auto_post":       f"Edit the draft before {post_date.strftime('%b %d')} if you\'d like changes — after that it schedules automatically.",
                    }.get(mode, "")
                    db.add(Notification(
                        company_id=ev.company_id, type="agent_draft_ready",
                        title=f"\u270f\ufe0f {ev.name} draft ready — event in {ev.lead_days} days",
                        body=f"Agent Niva has created a draft ad for {ev.name} ({event_date.strftime('%b %d')}). {mode_msg}",
                        action_url="/app/my-ads", dismissed_by=[],
                    ))
                    db.commit()
                    fired += 1
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[agent-events] event=%s Trigger 1 failed: %s", ev.id, exc)
                    db.rollback()

        return f"fired={fired} skipped_budget={skipped_budget}"
