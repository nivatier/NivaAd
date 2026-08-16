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
from app.models import Ad, AgentEvent, AgentRecommendation, AgentScrapeJob, BrandKit, BrandLogo, BrandVideoShot, CreditLedger, GenerationJob, Notification, PlatformConnection, PostJob, Product, ScheduledPost
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
from app.services.reframe import add_text_overlay, concat_video_clips, extract_last_frame, overlay_logo_on_video, prepare_video_reference_frame, probe_video_url_dimensions, reframe_image, reframe_video, reframe_video_to_dims, strip_audio
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
    "linkedin_personal": "professional, personal-voice, thought-leadership tone",
    "linkedin_company": "professional, brand-voice, outcome-focused",
    "x": "short and punchy, under 280 characters",
    "tiktok": "trendy, hook-first, gen-z friendly",
    "threads": "casual, conversational, community-first",
    "default": "clear, concise, and engaging — suitable for any channel",
}

def _resolve_platforms(platforms: list[str]) -> list[str]:
    """Return platforms as-is, or ["default"] when none are specified."""
    return platforms if platforms else ["default"]


def _shape(platforms: list[str]) -> str:
    inner = ",".join(
        f'"{p}":{{"caption":"...","hashtags":["#.."],"score":85,"tip":"one short improvement tip"}}'
        for p in platforms
    )
    return "{" + inner + "}"


def _sanitize(val: str | None) -> str:
    """Replace straight double-quotes in user input with typographic
    equivalents before injecting into prompts — prevents the LLM from
    echoing them unescaped inside JSON string values, which produces an
    'Unterminated string' parse error on the output."""
    if not val:
        return val or ""
    return val.replace('"', '\u201c').replace('"', '\u201d')


def _build_prompt(brief: dict, platforms: list[str], outputs: dict, feedback: str | None) -> str:
    import json as _json
    platforms = _resolve_platforms(platforms)
    fmt = outputs.get("format", "single")
    variations = outputs.get("variations", 1)
    is_default = platforms == ["default"]

    # Structured brief object — LLMs parse named fields more reliably
    # than a single concatenated sentence, so we present the brief as JSON
    # and give the task and output schema in the same message.
    brief_obj: dict = {
        "product_name": brief.get("product_name"),
        "description": brief.get("description"),
        "target_audience": brief.get("audience") or "general consumers",
        "campaign_goal": brief.get("goal"),
        "tone": brief.get("tone"),
    }
    if brief.get("offer"):
        brief_obj["offer"] = brief["offer"]
    scene = brief.get("env") or brief.get("image_scene")
    if scene:
        brief_obj["image_scene"] = scene
    if brief.get("tagline"):
        brief_obj["brand_tagline"] = brief["tagline"]
    if brief.get("copy_directions"):
        brief_obj["copy_directions"] = brief["copy_directions"]
    if fmt == "carousel":
        brief_obj["format"] = "carousel — caption must tease a swipe to see the next slide"

    platform_styles = {p: PLATFORM_STYLE.get(p, "platform-appropriate") for p in platforms}

    if is_default:
        task = (
            "Write ONE versatile, platform-agnostic social media ad caption. "
            "Rate the copy 0-100 for predicted engagement and give one concrete improvement tip."
        )
        output_schema = '{"default": {"caption": "...", "hashtags": ["#tag"], "score": 85, "tip": "one short tip"}}'
        return (
            "You are an expert social media ad copywriter.\n\n"
            f"## Brief\n```json\n{_json.dumps(brief_obj, indent=2, ensure_ascii=False)}\n```\n\n"
            f"## Task\n{task}\n\n"
            f"## Output\nRespond with ONLY this raw JSON, no markdown fences, no prose:\n{output_schema}"
        )

    if feedback:
        task = (
            f'The customer requested these changes: "{feedback}". '
            "Rewrite the ad copy applying those changes exactly, keeping the same platform structure."
        )
    elif variations == 3:
        task = (
            "Write 3 distinct creative angles for each platform, each with a different hook or audience slice. "
            f"Platform writing styles: {_json.dumps(platform_styles)}."
        )
    else:
        task = (
            "Write ad copy for each platform below, adapting style per platform. "
            f"Platform writing styles: {_json.dumps(platform_styles)}."
        )

    if variations == 3:
        s = _shape(platforms)
        output_schema = f'{{"variants":[{s},{s},{s}]}}'
    else:
        output_schema = _shape(platforms)

    return (
        "You are an expert social media ad copywriter.\n\n"
        f"## Brief\n```json\n{_json.dumps(brief_obj, indent=2, ensure_ascii=False)}\n```\n\n"
        f"## Task\n{task}\n"
        "For each platform also rate the copy 0-100 for predicted engagement (score) "
        "and give one concrete improvement tip.\n\n"
        f"## Output\nRespond with ONLY this raw JSON, no markdown fences, no prose:\n{output_schema}"
    )

def _video_prompt(brief: dict, shot_description: str | None = None, shot: dict | None = None) -> str:
    """Builds a structured JSON prompt for a single-shot video generation.

    JSON format gives the model unambiguous, field-by-field instructions
    rather than a free-text paragraph where fields can bleed into each
    other. Every field that has content is included; absent fields are
    omitted so the model isn't confused by empty values.

    shot — the full shot dict from the brief (carries voiceover_text and
    text_overlays); shot_description is its .prompt field, passed
    separately for backwards-compat with callers that only have the str."""
    import json as _json
    product = brief.get("product_name", "the product")
    reference_prompt = (brief.get("video_reference_prompt") or "").strip()
    camera_prompt = (brief.get("video_camera_style_prompt") or "").strip()
    neg_prompt = (brief.get("video_negative_prompt") or "").strip()
    music_label = (brief.get("video_background_music_label") or "").strip()

    scene_desc = (shot_description or "").strip()
    if not scene_desc:
        if brief.get("image_scene"):
            scene_desc = brief["image_scene"]
        else:
            scene_desc = "clean studio background, soft professional lighting, smooth camera movement"

    doc: dict = {
        "type": "advertising_video",
        "product": product,
        "style": "high-end commercial advertising, cinematic quality, no watermark",
    }
    if reference_prompt:
        doc["reference_instruction"] = reference_prompt
    doc["scene"] = scene_desc
    if camera_prompt:
        doc["camera_style"] = camera_prompt
    if music_label:
        doc["background_music_mood"] = music_label
    # Per-shot voiceover and timed text overlays
    if shot:
        voiceover = (shot.get("voiceover_text") or "").strip()
        if voiceover:
            doc["voiceover"] = voiceover
        overlays = shot.get("text_overlays") or []
        if overlays:
            doc["text_overlays"] = [
                {k: v for k, v in o.items() if v is not None and k != "overlay_style"}
                for o in overlays
            ]
    if neg_prompt:
        doc["negative_prompt"] = neg_prompt

    return _json.dumps(doc, ensure_ascii=False)


def _multi_shot_video_prompt(brief: dict, shots: list[dict]) -> str:
    """Builds a structured JSON prompt for a multi-shot video generation.

    Each shot is an object inside a "shots" array, carrying its own
    timing, scene description, and any voiceover or timed text overlays.
    Global fields (camera style, negative prompt, music mood) sit at the
    top level so the model applies them across the whole video without
    each shot needing to repeat them.

    Single-shot callers should use _video_prompt() instead, which also
    now emits JSON and accepts the full shot dict for per-shot fields."""
    import json as _json
    product = brief.get("product_name", "the product")
    reference_prompt = (brief.get("video_reference_prompt") or "").strip()
    camera_prompt = (brief.get("video_camera_style_prompt") or "").strip()
    global_neg = (brief.get("video_negative_prompt") or "").strip()
    music_label = (brief.get("video_background_music_label") or "").strip()

    shot_list = []
    elapsed = 0
    for i, shot in enumerate(shots):
        duration = shot.get("duration") or 6
        start, end = elapsed, elapsed + duration
        desc = (shot.get("prompt") or "").strip() or "continue the scene naturally"
        entry: dict = {
            "shot": i + 1,
            "timing_seconds": f"{start}-{end}",
            "scene": desc,
        }
        voiceover = (shot.get("voiceover_text") or "").strip()
        if voiceover:
            entry["voiceover"] = voiceover
        overlays = shot.get("text_overlays") or []
        if overlays:
            entry["text_overlays"] = [
                {k: v for k, v in o.items() if v is not None and k != "overlay_style"}
                for o in overlays
            ]
        shot_list.append(entry)
        elapsed = end

    doc: dict = {
        "type": "advertising_video",
        "product": product,
        "style": "high-end commercial advertising, smooth cinematic transitions between shots, consistent visual style throughout, no watermark",
        "shot_sequence": shot_list,
    }
    if reference_prompt:
        doc["reference_instruction"] = reference_prompt
    if camera_prompt:
        doc["camera_style"] = camera_prompt
    if music_label:
        doc["background_music_mood"] = music_label
    if global_neg:
        doc["negative_prompt"] = global_neg

    return _json.dumps(doc, ensure_ascii=False)


def _image_prompt(brief: dict, slide_description: str | None = None) -> str:
    """Builds a structured JSON prompt for image generation.

    Presenting the brief as a JSON object and the task as a separate
    section helps LLMs cleanly separate 'what the product is' from
    'what the image should look like', reducing hallucinated product
    details and improving scene-accuracy.

    slide_description (carousel mode) stages the same product differently
    per slide — omitted for single-image ads.
    """
    import json as _json

    product = brief.get("product_name", "the product")
    overlay = (brief.get("text_overlay") or "").strip()
    reference_url = brief.get("image_reference_image_url") or brief.get("product_image_url")

    # Build the brief object the LLM sees
    brief_obj: dict = {
        "product_name": product,
        "description": brief.get("description", ""),
    }
    if overlay:
        brief_obj["text_overlay"] = (
            f"{overlay} — render this text EXACTLY as written directly on the image, "
            "positioned and styled as described"
        )

    style_tail = (
        "High-end commercial ad photography style, sharp focus, no watermark."
        if overlay else
        "High-end commercial ad photography style, sharp focus, no text overlay, no watermark."
    )

    if reference_url:
        scene_base = brief.get("env") or "a clean, professional studio setting with soft natural lighting"
        scene = f"{scene_base}. Specifically for this shot: {slide_description}" if slide_description else scene_base
        brief_obj["reference_photo"] = "PROVIDED — the exact product shown in the reference image"
        brief_obj["target_scene"] = scene

        task_obj = {
            "task": "background_replacement_around_fixed_subject",
            "instructions": [
                "Extract the product from the reference photo EXACTLY as shown — identical shape, colour, texture, proportions, and any visible branding or labels.",
                f"Place this UNCHANGED product into the target scene: '{scene}'.",
                "Replace the ENTIRE background and environment — do not keep any part of the original reference photo's background.",
                "Add realistic lighting, shadows, and reflections consistent with the new environment so the product looks physically present in that scene.",
                "Ensure the ENTIRE product is fully visible within the frame with clear margin on all sides — do not crop or cut off any edge.",
                style_tail,
            ],
        }
        return (
            "## Brief\n"
            f"```json\n{_json.dumps(brief_obj, indent=2, ensure_ascii=False)}\n```\n\n"
            "## Task\n"
            f"```json\n{_json.dumps(task_obj, indent=2, ensure_ascii=False)}\n```"
        )
    else:
        # No reference photo — text-to-image generation
        if slide_description:
            brief_obj["slide_scene"] = slide_description
        elif brief.get("image_scene"):
            brief_obj["scene"] = brief["image_scene"]
        else:
            brief_obj["scene"] = "clean studio background, soft professional lighting"

        task_obj = {
            "task": "product_advertisement_photograph",
            "instructions": [
                "Generate a professional advertising photograph matching the brief above.",
                "Compose the shot so the ENTIRE product is fully visible with clear margin on all sides — do not crop or cut off any part of it.",
                style_tail,
            ],
        }
        return (
            "## Brief\n"
            f"```json\n{_json.dumps(brief_obj, indent=2, ensure_ascii=False)}\n```\n\n"
            "## Task\n"
            f"```json\n{_json.dumps(task_obj, indent=2, ensure_ascii=False)}\n```"
        )


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
            f"{settings.OPENROUTER_BASE_URL}/chat/completions",
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

        # Sanitize all free-text user fields in the brief once here so
        # every prompt function below (_build_prompt, _image_prompt,
        # _video_prompt, _multi_shot_video_prompt) receives clean input.
        # We work on a shallow copy so the stored brief row is untouched.
        _TEXT_FIELDS = (
            "product_name", "description", "audience", "offer", "tagline",
            "env", "image_scene", "text_overlay", "video_reference_prompt",
            "video_negative_prompt", "copy_directions",
        )
        brief = {
            **ad.brief,
            **{k: _sanitize(ad.brief.get(k)) for k in _TEXT_FIELDS if ad.brief.get(k)},
        }
        # Also sanitize shot prompts inside video_shots
        if brief.get("video_shots"):
            brief["video_shots"] = [
                {**s, "prompt": _sanitize(s.get("prompt"))} if s.get("prompt") else s
                for s in brief["video_shots"]
            ]
        feedback = _sanitize(feedback)

        try:
            if not feedback and brief.get("text_prompt_override"):
                prompt = brief["text_prompt_override"]
                logger.info("[text_prompt] job=%s USING OVERRIDE from confirmation popup", job_id)
            else:
                prompt = _build_prompt(brief, _resolve_platforms(ad.platforms or []), ad.outputs, feedback)
            text_model = brief.get("text_model") or "google/gemini-2.5-flash"  # resolved once at ad-creation time (ads.py), not re-looked-up here — same pattern as image_model/video_model
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
                    image_ref_url = None if skip_reference else (brief.get("image_reference_image_url") or brief.get("product_image_url"))
                    if image_ref_url:
                        data_url = storage.fetch_as_data_url(image_ref_url)
                        ref_urls = [data_url]

                    logo_url = brief.get("brand_logo_url")
                    logo_bytes = None
                    if logo_url:
                        try:
                            logo_bytes, _ = storage.fetch_bytes(logo_url)
                        except Exception as brand_fetch_exc:  # noqa: BLE001
                            logger.warning("[branding] job=%s could not fetch logo, skipping: %s", job_id, brand_fetch_exc)
                    placement = brief.get("brand_logo_placement") or "bottom-right"
                    logo_opacity = float(brief.get("brand_logo_opacity") or 1.0)
                    image_model_used = brief.get("image_model") or "google/gemini-2.5-flash-image"  # resolved once at ad-creation time (ads.py), not re-looked-up here — falls back to a sane default only if brief predates this field (old ads)
                    image_aspect_ratio = brief.get("image_aspect_ratio") or "1:1"

                    is_carousel = ad.outputs.get("format") == "carousel" and not brief.get("image_prompt_override")

                    if is_carousel:
                        slides = brief.get("carousel_slides") or []
                        # Per-slide theme overrides (Text/Image Theme Reference chosen
                        # independently per carousel slide) — falls back to the single
                        # shared env/image_scene/text_overlay for ads created before
                        # this existed, or for any slide left on "same as ad" by not
                        # sending an override.
                        carousel_theme = brief.get("carousel_theme") or []
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
                            slide_brief = brief
                            if i < len(carousel_theme) and carousel_theme[i]:
                                override = carousel_theme[i]
                                slide_brief = dict(brief)
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
                                slide_bytes, slide_ext = generate_image(img_prompt, image_model_used, reference_urls=ref_urls, aspect_ratio=image_aspect_ratio)
                                if logo_bytes:
                                    slide_bytes = composite_logo(slide_bytes, logo_bytes, placement, opacity=logo_opacity)
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
                        if brief.get("image_prompt_override"):
                            img_prompt = brief["image_prompt_override"]
                            logger.info("[image_prompt] job=%s USING OVERRIDE from confirmation popup", job_id)
                        else:
                            img_prompt = _image_prompt(brief)
                        logger.info(
                            "[image_prompt] job=%s has_reference=%s\n----- PROMPT START -----\n%s\n----- PROMPT END -----",
                            job_id, bool(ref_urls), img_prompt,
                        )
                        try:
                            img_bytes, ext = generate_image(img_prompt, image_model_used, reference_urls=ref_urls, aspect_ratio=image_aspect_ratio)
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
                            img_bytes = composite_logo(img_bytes, logo_bytes, placement, opacity=float(brief.get("brand_logo_opacity") or 1.0))
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
                        refund = brief.get("image_model_credits") or 0
                        if refund > 0:
                            db.add(CreditLedger(company_id=job.company_id, delta=refund, reason="refund", ref_id=str(ad.id)))

            if not feedback and ad.outputs.get("video"):
                try:
                    shots = brief.get("video_shots") or []
                    if not shots:
                        # Defensive fallback — shouldn't happen given the
                        # frontend always sends at least one shot, but
                        # avoids a hard crash if it ever does.
                        shots = [{"prompt": None, "duration": 6}]

                    frame_image_url = None
                    if not skip_reference and brief.get("video_frame_image_url"):
                        # Deliberately a SEPARATE, explicit field from
                        # product_image_url (used for image generation) —
                        # what's used as the video's starting frame is
                        # now always exactly what was attached in the
                        # video section of Step 2, never an implicit
                        # reuse of the general product photo.
                        frame_image_url = storage.fetch_as_data_url(brief["video_frame_image_url"])

                    # Two background quality steps, both developer-
                    # configured, neither customer-facing or customer-
                    # charged (see services/video_prep.py) — run BEFORE
                    # the main video prompt is built, so both feed into
                    # it rather than happening alongside it. Shot review
                    # specifically is opt-in per-ad now (refine_video_prompt) —
                    # a configured review model doesn't mean it's always
                    # applied; the customer decides per generation.
                    prep_settings = get_video_prep_settings_sync(db)
                    if brief.get("refine_video_prompt") and prep_settings.get("prompt_review_model_id"):
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
                    if frame_image_url and brief.get("video_mode", "single_reference") == "single_reference" and brief.get("refine_video_frame") and prep_settings.get("image_model_id"):
                        prep_models = get_available_models_sync(db)
                        prep_entry = next((m for m in prep_models.get("image", []) if m["id"] == prep_settings["image_model_id"]), None)
                        first_shot_desc = (shots[0].get("prompt") or "").strip() if shots else ""
                        if prep_entry and first_shot_desc:
                            try:
                                product_name = brief.get("product_name", "the product")
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
                    if not skip_reference and brief.get("video_mode") == "first_last_frame" and brief.get("video_end_frame_image_url"):
                        end_frame_image_url = storage.fetch_as_data_url(brief["video_end_frame_image_url"])

                    video_model = brief.get("video_model") or "alibaba/wan-2.7"  # resolved once at ad-creation time (ads.py), not re-looked-up here
                    video_resolution = brief.get("video_resolution") or "720p"
                    video_aspect_ratio = brief.get("video_aspect_ratio") or None
                    video_audio = brief.get("video_audio")  # None means "let OpenRouter use the model's own default" — only set when the customer actually had an audio toggle to choose from
                    total_duration = sum(s.get("duration") or 0 for s in shots) or 6

                    # The confirmation popup's edited/reviewed prompt is
                    # now used directly regardless of shot count — it
                    # already reflects shot review (if configured) and
                    # any manual edits the customer made, so there's no
                    # reason to rebuild from the raw shots and
                    # potentially re-review them a second time,
                    # producing a DIFFERENT result than what was actually
                    # confirmed.
                    if brief.get("video_prompt_override"):
                        video_prompt = brief["video_prompt_override"]
                        logger.info("[video_prompt] job=%s USING OVERRIDE from confirmation popup", job_id)
                    elif len(shots) == 1:
                        video_prompt = _video_prompt(brief, shots[0].get("prompt"), shot=shots[0])
                    else:
                        video_prompt = _multi_shot_video_prompt(brief, shots)
                    logger.info(
                        "[video_prompt] job=%s shots=%d total_duration=%ds\n----- PROMPT START -----\n%s\n----- PROMPT END -----",
                        job_id, len(shots), total_duration, video_prompt,
                    )

                    try:
                        video_bytes = generate_video(video_prompt, video_model, duration=total_duration, resolution=video_resolution, frame_image_url=frame_image_url, end_frame_image_url=end_frame_image_url, audio=video_audio, aspect_ratio=video_aspect_ratio)
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
                    video_url = _stitch_intro_outro(db, brief, ad.company_id, video_url, f"job={job_id}")
                    # Logo overlay — applied AFTER stitch so it appears on
                    # the full [intro + main + outro] video, not just the
                    # AI-generated main clip. Re-fetches the stitched bytes.
                    video_logo_url = brief.get("brand_logo_url")
                    if video_logo_url:
                        try:
                            video_logo_bytes, _ = storage.fetch_bytes(video_logo_url)
                            video_bytes_stitched, _ = storage.fetch_bytes(video_url)
                            video_bytes_with_logo = overlay_logo_on_video(
                                video_bytes_stitched, video_logo_bytes,
                                placement=brief.get("brand_logo_placement") or "bottom-right",
                                opacity=float(brief.get("brand_logo_opacity") or 1.0),
                            )
                            video_url = storage.upload_bytes(video_bytes_with_logo, "video/mp4", "mp4")
                            logger.info("[branding] job=%s logo overlaid on video at %s opacity=%.2f", job_id, brief.get("brand_logo_placement"), float(brief.get("brand_logo_opacity") or 1.0))
                        except Exception as vid_logo_exc:  # noqa: BLE001
                            logger.warning("[branding] job=%s video logo overlay failed, using video without logo: %s", job_id, vid_logo_exc)
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
                        refund = brief.get("video_model_credits") or 0
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
                    img_bytes = composite_logo(img_bytes, logo_bytes, placement, opacity=float(ad.brief.get("brand_logo_opacity") or 1.0))
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
                image_aspect_ratio = ad.brief.get("image_aspect_ratio") or "1:1"
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
                    img_bytes, ext = generate_image(img_prompt, image_model, reference_urls=ref_urls, aspect_ratio=image_aspect_ratio)
                except Exception as ref_exc:  # noqa: BLE001
                    if ref_urls:
                        raise RuntimeError(f"REFERENCE_REJECTED::{ref_exc}") from ref_exc
                    raise

                logo_url = ad.brief.get("brand_logo_url")
                if logo_url:
                    try:
                        logo_bytes, _ = storage.fetch_bytes(logo_url)
                        placement = ad.brief.get("brand_logo_placement") or "bottom-right"
                        img_bytes = composite_logo(img_bytes, logo_bytes, placement, opacity=float(ad.brief.get("brand_logo_opacity") or 1.0))
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
                video_aspect_ratio = ad.brief.get("video_aspect_ratio") or None
                video_audio = ad.brief.get("video_audio")
                total_duration = sum(s.get("duration") or 0 for s in shots) or 6

                if ad.brief.get("video_prompt_override"):
                    video_prompt = ad.brief["video_prompt_override"]
                elif len(shots) == 1:
                    video_prompt = _video_prompt(ad.brief, shots[0].get("prompt"), shot=shots[0])
                else:
                    video_prompt = _multi_shot_video_prompt(ad.brief, shots)
                logger.info(
                    "[video_prompt] job=%s (campaign ad) shots=%d total_duration=%ds\n----- PROMPT START -----\n%s\n----- PROMPT END -----",
                    job_id, len(shots), total_duration, video_prompt,
                )

                try:
                    video_bytes = generate_video(video_prompt, video_model, duration=total_duration, resolution=video_resolution, frame_image_url=frame_image_url, end_frame_image_url=end_frame_image_url, audio=video_audio, aspect_ratio=video_aspect_ratio)
                except Exception as frame_exc:  # noqa: BLE001
                    if frame_image_url:
                        raise RuntimeError(f"REFERENCE_REJECTED::{frame_exc}") from frame_exc
                    raise

                video_url = storage.upload_bytes(video_bytes, "video/mp4", "mp4")
                video_url = _stitch_intro_outro(db, ad.brief, ad.company_id, video_url, f"job={job_id}")
                # Logo overlay — same as generate_ad, applied after stitch
                video_logo_url = ad.brief.get("brand_logo_url")
                if video_logo_url:
                    try:
                        video_logo_bytes, _ = storage.fetch_bytes(video_logo_url)
                        video_bytes_stitched, _ = storage.fetch_bytes(video_url)
                        video_bytes_with_logo = overlay_logo_on_video(
                            video_bytes_stitched, video_logo_bytes,
                            placement=ad.brief.get("brand_logo_placement") or "bottom-right",
                            opacity=float(ad.brief.get("brand_logo_opacity") or 1.0),
                        )
                        video_url = storage.upload_bytes(video_bytes_with_logo, "video/mp4", "mp4")
                        logger.info("[branding] job=%s (campaign) logo overlaid on video", job_id)
                    except Exception as vid_logo_exc:  # noqa: BLE001
                        logger.warning("[branding] job=%s (campaign) video logo overlay failed: %s", job_id, vid_logo_exc)
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
            # linkedin_personal is the real integration ID — "linkedin" was the
            # old pre-split id used before personal/company were separated.
            # Ad.platforms stores the ad-targeting id ("linkedin") but
            # ScheduledPost.platform stores the connection id ("linkedin_personal").
            # Match on both so ads targeted to "linkedin" post via "linkedin_personal".
            is_linkedin_personal = sp.platform in ("linkedin_personal", "linkedin")
            # Read mock_posting and linkedin api_version from DB config (sync session — works fine here)
            from app.models import get_config_row_sync as _gcr
            from app.services.platform_config import get_platform_integrations_sync as _get_platforms
            _platform_cfg = (_gcr(db, "platform").config or {})
            _launch_cfg = _platform_cfg.get("launch", {})
            mock_posting = _launch_cfg.get("mock_posting", settings.MOCK_POSTING)
            _li_cfg = next((p for p in _get_platforms(db) if p.get("id") in ("linkedin_personal", "linkedin_company", "linkedin")), {})
            linkedin_api_version = (_li_cfg.get("api_version") or "").strip() or linkedin.LINKEDIN_API_VERSION
            if is_linkedin_personal and not mock_posting:
                conn = db.scalar(select(PlatformConnection).where(
                    PlatformConnection.company_id == sp.company_id,
                    PlatformConnection.platform.in_(["linkedin_personal", "linkedin"]),
                ))
                if not (conn and conn.status == "connected"):
                    sp.status = "failed"
                    failed_count += 1
                    continue
                try:
                    access_token = decrypt_token(conn.encrypted_token)
                    person_urn = linkedin.get_person_urn(access_token)
                    variant = (ad.results or {}).get("variants", [{}])[0] if ad and ad.results else {}
                    caption = (variant.get("linkedin") or variant.get("linkedin_personal") or {}).get("caption") or ""
                    platform_image_urls = variant.get("platform_image_urls") or {}
                    image_url = platform_image_urls.get(sp.platform) or platform_image_urls.get("linkedin") or variant.get("image_url")
                    platform_video_urls = variant.get("platform_video_urls") or {}
                    video_url = platform_video_urls.get(sp.platform) or platform_video_urls.get("linkedin") or variant.get("video_url")
                    linkedin.post_to_linkedin(access_token, person_urn, caption, api_version=linkedin_api_version, image_url=image_url, video_url=video_url)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[schedule] scheduled_post=%s LinkedIn post failed: %s", sp.id, exc)
                    sp.status = "failed"
                    failed_count += 1
                    continue

            elif sp.platform == "tiktok" and not mock_posting:
                from app.services import tiktok as tiktok_svc
                import json as _json
                conn = db.scalar(select(PlatformConnection).where(
                    PlatformConnection.company_id == sp.company_id,
                    PlatformConnection.platform == "tiktok",
                ))
                if not (conn and conn.status == "connected"):
                    sp.status = "failed"
                    failed_count += 1
                    continue
                try:
                    stored = _json.loads(decrypt_token(conn.encrypted_token))
                    access_token = stored["access_token"]
                    variant = (ad.results or {}).get("variants", [{}])[0] if ad and ad.results else {}
                    caption = (variant.get("tiktok") or {}).get("caption") or ""
                    platform_image_urls = variant.get("platform_image_urls") or {}
                    image_url = platform_image_urls.get("tiktok") or variant.get("image_url")
                    platform_video_urls = variant.get("platform_video_urls") or {}
                    video_url = platform_video_urls.get("tiktok") or variant.get("video_url")
                    extra_images = [
                        u for u in (variant.get("carousel_image_urls") or [])
                        if u and u != image_url
                    ]
                    tiktok_svc.post_to_tiktok(
                        access_token, caption,
                        image_url=image_url,
                        video_url=video_url,
                        extra_image_urls=extra_images or None,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[schedule] scheduled_post=%s TikTok post failed: %s", sp.id, exc)
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
                site_text = scrape_company_website(job.url, db=db)
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


def _create_agent_ad_sync(db, company_id, product_name: str, description: str, platforms: list[str], agent_source: str, agent_event_id=None, product_id=None, event: "AgentEvent | None" = None) -> "Ad":
    """Builds and generates one ad directly from the Celery/sync world.

    When called for a recurring event (agent_source == "event"), switches
    to a branded GREETING prompt path instead of a product-ad path:
      - Image: thematic scene built around the occasion + brand colours,
               with clean space for the logo (no AI-rendered text).
               If a reference_image_url is set on the event it is passed
               as image_reference_image_url so the existing reference-
               image pipeline uses it as a visual anchor.
      - Text:  a warm/professional/fun/luxury occasion greeting on behalf
               of the company — no sales pitch, signs off with the
               company name.
      - Logo:  always composited via the existing composite_logo pipeline
               (brand_logo_url + brand_logo_placement + brand_logo_opacity
               from BrandKit). No logo → image still generates, just
               without the overlay.
    """
    text_model, image_model = _resolve_default_text_and_image_models(db)
    cost = (text_model.get("credits") or 0) + (image_model.get("credits") or 0)

    product = db.get(Product, product_id) if product_id else None

    # ── Brand kit — always read; used for greeting and regular ads ────
    brand_kit = db.scalar(select(BrandKit).where(BrandKit.company_id == company_id))
    brand_logo_url       = brand_kit.logo_url       if brand_kit else None
    brand_logo_placement = brand_kit.logo_placement  if brand_kit else "bottom-right"
    brand_logo_opacity   = float(brand_kit.logo_opacity) if brand_kit and brand_kit.logo_opacity is not None else 1.0
    primary_color        = brand_kit.primary_color  if brand_kit else "#7c3aed"
    tagline              = brand_kit.tagline        if brand_kit else ""
    company_name         = product_name  # product_name is passed as ev.name for events, but we want the company name for greetings

    if agent_source == "event" and event is not None:
        # ── Greeting / occasion post ───────────────────────────────────
        wish_tone    = event.wish_tone    or "warm"
        visual_style = event.visual_style or "festive"
        event_name   = event.name

        TONE_COPY = {
            "warm":         "warm, genuine, and heartfelt",
            "professional": "professional, sincere, and polished",
            "fun":          "fun, upbeat, and playful",
            "luxury":       "sophisticated, elegant, and exclusive",
        }
        STYLE_IMAGE = {
            "festive":  "warm golden bokeh, festive decorations, soft glowing lights, rich seasonal colours",
            "minimal":  "clean white or neutral background, simple elegant composition, plenty of negative space",
            "bold":     "vibrant high-contrast colours, dynamic graphic shapes, energetic composition",
            "elegant":  "soft muted palette, graceful flowing shapes, refined luxurious atmosphere",
        }

        tone_desc  = TONE_COPY.get(wish_tone, TONE_COPY["warm"])
        style_desc = STYLE_IMAGE.get(visual_style, STYLE_IMAGE["festive"])

        # Fetch the company name from the company table for the greeting sign-off
        from app.models import Company
        company_row = db.get(Company, company_id)
        company_name = company_row.name if company_row else event_name

        image_scene = (
            f"{visual_style.capitalize()} {event_name} greeting scene. "
            f"{style_desc}. "
            f"Colour palette anchored to {primary_color}. "
            f"Prominent clean area for company logo placement. "
            f"Absolutely NO text, words, or letters rendered anywhere in the image. "
            f"High quality, photorealistic, social media ready."
        )

        text_prompt_override = (
            f"You are a brand communications writer. Write a {tone_desc} {event_name} greeting post "
            f"on behalf of {company_name}. "
            f"2-3 sentences max. Genuine and human — no sales pitch, no promotions, no product mentions. "
            + (f'Weave in the tagline naturally if it fits: "{tagline}". ' if tagline else "")
            + (f"Additional context from the company: {event.guidance}. " if event.guidance else "")
            + f"Sign off warmly with the company name ({company_name}). "
            f"Write one version per platform listed, adapted to each platform's style. "
            f"Respond ONLY with raw JSON, no markdown fences: {_shape(platforms or ['default'])}"
        )

        # Reference image — from event upload or linked product
        ref_image_url = event.reference_image_url or (product.image_url if product else None)

        brief = {
            "product_name": event_name,
            "description": f"{event_name} occasion greeting",
            "audience": "everyone", "offer": "", "goal": "Brand awareness",
            "tone": wish_tone.capitalize(),
            "env": None, "image_scene": image_scene,
            "image_reference_image_url": ref_image_url,
            "text_prompt_override": text_prompt_override,
            "brand_logo_url": brand_logo_url,
            "brand_logo_placement": brand_logo_placement,
            "brand_logo_opacity": brand_logo_opacity,
            "tagline": tagline,
            "text_model": text_model["model"], "text_model_credits": text_model.get("credits"),
            "image_model": image_model["model"], "image_model_credits": image_model.get("credits"),
        }
    else:
        # ── Regular agent ad (Quick Start, recommendations, etc.) ─────
        brief = {
            "product_name": product_name, "description": description,
            "audience": "", "offer": "", "goal": "Drive sales", "tone": "Professional",
            "env": None, "image_scene": description,
            "product_image_url": product.image_url if product else None,
            "brand_logo_url": brand_logo_url,
            "brand_logo_placement": brand_logo_placement,
            "brand_logo_opacity": brand_logo_opacity,
            "text_model": text_model["model"], "text_model_credits": text_model.get("credits"),
            "image_model": image_model["model"], "image_model_credits": image_model.get("credits"),
        }

    ad = Ad(
        company_id=company_id, created_by=None, product_id=product_id,
        brief=brief,
        platforms=platforms,
        outputs={"text": True, "image": True, "video": False, "format": "single", "variations": 1},
        status="generating", agent_source=agent_source, agent_event_id=agent_event_id,
    )
    db.add(ad)
    db.flush()

    job = GenerationJob(company_id=company_id, ad_id=ad.id, kind="ad", credits_cost=cost)
    db.add(job)
    db.add(CreditLedger(company_id=company_id, delta=-cost, reason="generation", ref_id=str(ad.id)))
    db.commit()

    generate_ad(str(job.id))  # direct call, not .delay() — already inside a worker
    return ad


@celery_app.task(name="app.cleanup_expired_logs")
def cleanup_expired_logs():
    """Daily cleanup of the system_logs table — deletes rows older than
    log_retention_days (default 30). Runs at 2 AM UTC, before media
    and post cleanup, so the log of the cleanup itself is retained."""
    from app.models import SystemLog
    from app.services.retention import get_log_retention_days_sync
    with Session(sync_engine) as db:
        days = get_log_retention_days_sync(db)
        cutoff = datetime.utcnow() - timedelta(days=days)
        result = db.execute(
            delete(SystemLog).where(SystemLog.created_at < cutoff)
        )
        db.commit()
        deleted = result.rowcount
        logger.info("[logs] cleanup deleted=%d cutoff=%s", deleted, cutoff.isoformat())
        return f"deleted {deleted} log rows older than {days} days"


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

                scheduled_at = datetime.combine(event_date, datetime.min.time().replace(
                    hour=ev.post_hour if ev.post_hour is not None else 10,
                    minute=ev.post_minute if ev.post_minute is not None else 0,
                ))

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
                        description=ev.guidance or f"A {ev.name} greeting post",
                        platforms=ev.platforms or ["facebook", "instagram"],
                        agent_source="event", agent_event_id=ev.id, product_id=ev.product_id,
                        event=ev,
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


# ── Post Now (async) ─────────────────────────────────────────────────────────

@celery_app.task(name="app.post_ad_now", bind=True, max_retries=3, default_retry_delay=10)
def post_ad_now(self, post_job_id: str):
    """Async Celery task: posts an ad to one or more platforms.

    Called by POST /ads/{id}/post — the endpoint creates a PostJob row,
    queues this task, and returns immediately with the job_id so the
    frontend can poll GET /ads/{id}/post-status/{job_id} for progress.

    Each platform is attempted independently — if LinkedIn fails, other
    platforms still go through. Results stored on the PostJob row.

    Retries (max 3, 10s delay) handle transient network failures such
    as LinkedIn image upload timeouts. On retry the task is idempotent
    because we check ad.posted_platforms before posting to avoid
    double-posting a platform that already succeeded in a prior attempt.
    """
    import uuid as _uuid
    with Session(sync_engine) as db:
        job = db.get(PostJob, _uuid.UUID(post_job_id))
        if job is None:
            logger.warning("[post_ad_now] PostJob %s not found", post_job_id)
            return "not found"

        job.status = "running"
        db.commit()

        ad = db.get(Ad, job.ad_id)
        if ad is None:
            job.status = "failed"
            job.error = "Ad not found"
            job.finished_at = datetime.utcnow()
            db.commit()
            return "ad not found"

        # Read config — mock_posting + LinkedIn api_version
        from app.models import get_config_row_sync as _gcr
        from app.services.platform_config import get_platform_integrations_sync as _get_platforms
        _platform_cfg = (_gcr(db, "platform").config or {})
        mock_posting = _platform_cfg.get("launch", {}).get("mock_posting", settings.MOCK_POSTING)
        _li_cfg = next(
            (p for p in _get_platforms(db) if p.get("id") in ("linkedin_personal", "linkedin_company", "linkedin")),
            {}
        )
        linkedin_api_version = (_li_cfg.get("api_version") or "").strip() or linkedin.LINKEDIN_API_VERSION

        variant = (ad.results or {}).get("variants", [{}])[0] if ad.results else {}
        platform_image_urls = variant.get("platform_image_urls") or {}

        succeeded: list[str] = list(job.succeeded or [])  # preserve from prior retry attempt
        permanent_failures: set[str] = set()  # 4xx errors — no retry
        failed: dict[str, str] = dict(job.failed or {})

        for platform in job.platforms:
            # Skip platforms already posted in a previous retry attempt
            if platform in succeeded:
                continue

            is_linkedin = platform in ("linkedin", "linkedin_personal")
            if is_linkedin and not mock_posting:
                conn = db.scalar(select(PlatformConnection).where(
                    PlatformConnection.company_id == job.company_id,
                    PlatformConnection.platform.in_(["linkedin_personal", "linkedin"]),
                ))
                if not (conn and conn.status == "connected"):
                    failed[platform] = "LinkedIn isn't connected — connect it in Settings first."
                    continue
                try:
                    access_token = decrypt_token(conn.encrypted_token)
                    person_urn = linkedin.get_person_urn(access_token)
                    caption = (variant.get(platform) or variant.get("linkedin") or variant.get("linkedin_personal") or {}).get("caption") or ""
                    image_url = platform_image_urls.get(platform) or platform_image_urls.get("linkedin") or variant.get("image_url")
                    platform_video_urls = variant.get("platform_video_urls") or {}
                    video_url = platform_video_urls.get(platform) or platform_video_urls.get("linkedin") or variant.get("video_url")
                    logger.info("[post_ad_now] job=%s linkedin posting: image_url=%s video_url=%s", post_job_id, image_url, video_url)
                    linkedin.post_to_linkedin(access_token, person_urn, caption, api_version=linkedin_api_version, image_url=image_url, video_url=video_url)
                    succeeded.append(platform)
                    # Remove from failed if it succeeded on retry
                    failed.pop(platform, None)
                except Exception as exc:  # noqa: BLE001
                    err_str = str(exc)[:300]
                    failed[platform] = err_str
                    # Mark 4xx errors as permanent — no point retrying duplicate posts,
                    # bad requests, or auth failures (only 5xx / network errors should retry).
                    err_lower = err_str.lower()
                    if any(code in err_lower for code in ("422", "400", "401", "403", "duplicate", "bad request")):
                        permanent_failures.add(platform)
                    logger.warning("[post_ad_now] job=%s platform=%s failed: %s", post_job_id, platform, exc)
            elif platform == "tiktok" and not mock_posting:
                from app.services import tiktok as tiktok_svc
                from app.services.token_crypto import decrypt_token as _decrypt
                conn = db.scalar(select(PlatformConnection).where(
                    PlatformConnection.company_id == job.company_id,
                    PlatformConnection.platform == "tiktok",
                ))
                if not (conn and conn.status == "connected"):
                    failed[platform] = "TikTok isn\'t connected — connect it in Connections first."
                    continue
                try:
                    import json as _json
                    stored = _json.loads(_decrypt(conn.encrypted_token))
                    access_token = stored["access_token"]
                    caption = (variant.get("tiktok") or {}).get("caption") or ""
                    image_url = platform_image_urls.get("tiktok") or variant.get("image_url")
                    platform_video_urls = variant.get("platform_video_urls") or {}
                    video_url = platform_video_urls.get("tiktok") or variant.get("video_url")
                    extra_images = [
                        u for u in (variant.get("carousel_image_urls") or [])
                        if u and u != image_url
                    ]
                    logger.info(
                        "[post_ad_now] job=%s tiktok posting: image=%s video=%s extra_images=%d",
                        post_job_id, image_url, video_url, len(extra_images),
                    )
                    publish_id = tiktok_svc.post_to_tiktok(
                        access_token, caption,
                        image_url=image_url,
                        video_url=video_url,
                        extra_image_urls=extra_images or None,
                    )
                    # Store publish_id so /webhooks/tiktok can match the
                    # async TikTok status callback back to this PostJob.
                    existing_ids = list(job.tiktok_publish_ids or [])
                    if publish_id and publish_id not in existing_ids:
                        existing_ids.append(publish_id)
                        job.tiktok_publish_ids = existing_ids
                    succeeded.append(platform)
                    failed.pop(platform, None)
                except Exception as exc:  # noqa: BLE001
                    err_str = str(exc)[:300]
                    failed[platform] = err_str
                    err_lower = err_str.lower()
                    if any(code in err_lower for code in ("422", "400", "401", "403", "duplicate", "bad request")):
                        permanent_failures.add(platform)
                    logger.warning("[post_ad_now] job=%s platform=%s failed: %s", post_job_id, platform, exc)
            elif platform == "facebook" and not mock_posting:
                from app.services import meta as meta_svc
                conn = db.scalar(select(PlatformConnection).where(
                    PlatformConnection.company_id == job.company_id,
                    PlatformConnection.platform == "facebook",
                ))
                if not (conn and conn.status == "connected"):
                    failed[platform] = "Facebook isn't connected — connect it in Connections first."
                    continue
                try:
                    import json as _json
                    stored = _json.loads(decrypt_token(conn.encrypted_token))
                    page_token = stored["page_token"]
                    page_id = stored["page_id"]
                    caption = (variant.get("facebook") or {}).get("caption") or ""
                    image_url = (variant.get("platform_image_urls") or {}).get("facebook") or variant.get("image_url")
                    platform_video_urls = variant.get("platform_video_urls") or {}
                    video_url = platform_video_urls.get("facebook") or variant.get("video_url")
                    logger.info("[post_ad_now] job=%s facebook posting: image=%s video=%s", post_job_id, image_url, video_url)
                    meta_svc.post_to_facebook(page_token, page_id, caption, image_url=image_url, video_url=video_url)
                    succeeded.append(platform)
                    failed.pop(platform, None)
                except Exception as exc:  # noqa: BLE001
                    err_str = str(exc)[:300]
                    failed[platform] = err_str
                    if any(c in err_str.lower() for c in ("400", "401", "403", "invalid")):
                        permanent_failures.add(platform)
                    logger.warning("[post_ad_now] job=%s platform=%s failed: %s", post_job_id, platform, exc)

            elif platform == "instagram" and not mock_posting:
                from app.services import meta as meta_svc
                conn = db.scalar(select(PlatformConnection).where(
                    PlatformConnection.company_id == job.company_id,
                    PlatformConnection.platform == "instagram",
                ))
                if not (conn and conn.status == "connected"):
                    failed[platform] = "Instagram isn't connected — connect it via Facebook in Connections."
                    continue
                try:
                    import json as _json
                    stored = _json.loads(decrypt_token(conn.encrypted_token))
                    page_token = stored["page_token"]
                    ig_user_id = stored["ig_user_id"]
                    caption = (variant.get("instagram") or {}).get("caption") or ""
                    image_url = (variant.get("platform_image_urls") or {}).get("instagram") or variant.get("image_url")
                    platform_video_urls = variant.get("platform_video_urls") or {}
                    video_url = platform_video_urls.get("instagram") or variant.get("video_url")
                    logger.info("[post_ad_now] job=%s instagram posting: image=%s video=%s", post_job_id, image_url, video_url)
                    meta_svc.post_to_instagram(page_token, ig_user_id, caption, image_url=image_url, video_url=video_url)
                    succeeded.append(platform)
                    failed.pop(platform, None)
                except Exception as exc:  # noqa: BLE001
                    err_str = str(exc)[:300]
                    failed[platform] = err_str
                    if any(c in err_str.lower() for c in ("400", "401", "403", "invalid")):
                        permanent_failures.add(platform)
                    logger.warning("[post_ad_now] job=%s platform=%s failed: %s", post_job_id, platform, exc)

            elif platform == "threads" and not mock_posting:
                from app.services import meta as meta_svc
                conn = db.scalar(select(PlatformConnection).where(
                    PlatformConnection.company_id == job.company_id,
                    PlatformConnection.platform == "threads",
                ))
                if not (conn and conn.status == "connected"):
                    failed[platform] = "Threads isn't connected — connect it via Facebook in Connections."
                    continue
                try:
                    import json as _json
                    stored = _json.loads(decrypt_token(conn.encrypted_token))
                    user_token = stored["user_token"]
                    threads_user_id = stored["threads_user_id"]
                    caption = (variant.get("threads") or {}).get("caption") or ""
                    image_url = (variant.get("platform_image_urls") or {}).get("threads") or variant.get("image_url")
                    platform_video_urls = variant.get("platform_video_urls") or {}
                    video_url = platform_video_urls.get("threads") or variant.get("video_url")
                    meta_svc.post_to_threads(user_token, threads_user_id, caption, image_url=image_url, video_url=video_url)
                    succeeded.append(platform)
                    failed.pop(platform, None)
                except Exception as exc:  # noqa: BLE001
                    err_str = str(exc)[:300]
                    failed[platform] = err_str
                    if any(c in err_str.lower() for c in ("400", "401", "403", "invalid")):
                        permanent_failures.add(platform)
                    logger.warning("[post_ad_now] job=%s platform=%s failed: %s", post_job_id, platform, exc)

            else:
                # Mock or non-integrated platform — simulate success
                succeeded.append(platform)

        # Persist per-platform results
        job.succeeded = succeeded
        job.failed = failed

        # Update the ad's posted_platforms
        if succeeded:
            current = set(ad.posted_platforms or [])
            current.update(succeeded)
            ad.posted_platforms = list(current)
            flag_modified(ad, "posted_platforms")
            if ad.posted_at is None:
                ad.posted_at = datetime.utcnow()
            ad.status = "posted"

            # Resolve any pending scheduled posts for these platforms
            pending_scheduled = db.scalars(
                select(ScheduledPost).where(
                    ScheduledPost.ad_id == ad.id,
                    ScheduledPost.platform.in_(succeeded),
                    ScheduledPost.status == "pending",
                )
            ).all()
            for sp in pending_scheduled:
                sp.status = "posted"
                sp.posted_at = ad.posted_at

        # Determine final job status
        all_done = len(succeeded) + len(failed) >= len(job.platforms)
        if all_done:
            job.status = "done" if not failed else "partial"
            job.finished_at = datetime.utcnow()
        else:
            # Some platforms neither succeeded nor failed — shouldn't happen,
            # but treat as failed
            job.status = "done"
            job.finished_at = datetime.utcnow()

        db.commit()

        # Only retry transient failures (5xx / network) — not permanent 4xx errors.
        transient_failures = {p: m for p, m in failed.items() if p not in permanent_failures}
        if transient_failures:
            remaining_retries = self.max_retries - self.request.retries
            if remaining_retries > 0:
                logger.info(
                    "[post_ad_now] job=%s %d platform(s) failed transiently, retrying (%d left)...",
                    post_job_id, len(transient_failures), remaining_retries
                )
                raise self.retry(countdown=10)
        if permanent_failures:
            logger.warning("[post_ad_now] job=%s permanent failures (not retrying): %s", post_job_id, dict({p: failed[p] for p in permanent_failures}))

        return f"done: succeeded={succeeded} failed={list(failed.keys())}"


@celery_app.task(name="app.reset_monthly_credits", bind=True)
def reset_monthly_credits(self):
    """Daily beat task — resets plan credits for subscribers whose monthly
    anniversary falls on today.

    Covers multi-month (3, 6) and annual (12) plans that Stripe only invoices
    once per term, so invoice.paid cannot drive monthly resets for them.
    Monthly plans (term_months=1) are handled by the invoice.paid webhook.

    Anniversary logic:
    - Sub started Aug 15 → resets on the 15th of every month.
    - Sub started Jan 31 → resets on the last day of shorter months
      (e.g. Feb 28/29, Apr 30).
    """
    import calendar
    from datetime import date, datetime
    from sqlalchemy import func, select as _select
    from app.models import AuditLog, CreditLedger, Subscription
    from app.services import billing as billing_svc
    from sqlalchemy.orm import Session

    today = date.today()

    with Session(sync_engine) as db:
        # Find all active non-monthly paid subscriptions
        subs = db.scalars(
            _select(Subscription).where(
                Subscription.status == "active",
                Subscription.tier.in_(["starter", "pro"]),
                Subscription.term_months > 1,
                Subscription.stripe_subscription_id.isnot(None),
            )
        ).all()

        reset_count = 0
        for sub in subs:
            # Calculate the anniversary day for this month
            sub_day = sub.created_at.day
            last_day = calendar.monthrange(today.year, today.month)[1]
            anniversary_day = min(sub_day, last_day)

            if today.day != anniversary_day:
                continue

            # Skip if we already reset this sub this month
            month_start = datetime(today.year, today.month, 1)
            already_reset = db.scalar(
                _select(CreditLedger).where(
                    CreditLedger.company_id == sub.company_id,
                    CreditLedger.reason == "plan_grant",
                    CreditLedger.created_at >= month_start,
                )
            )
            if already_reset:
                logger.info(
                    "[reset_monthly_credits] skipping company=%s — already reset this month",
                    sub.company_id,
                )
                continue

            # Expire unused plan credits (use-it-or-lose-it)
            granted = db.scalar(
                _select(func.coalesce(func.sum(CreditLedger.delta), 0))
                .where(
                    CreditLedger.company_id == sub.company_id,
                    CreditLedger.reason == "plan_grant",
                )
            ) or 0
            total_used = db.scalar(
                _select(func.coalesce(func.sum(CreditLedger.delta), 0))
                .where(
                    CreditLedger.company_id == sub.company_id,
                    CreditLedger.delta < 0,
                )
            ) or 0
            topup_granted = db.scalar(
                _select(func.coalesce(func.sum(CreditLedger.delta), 0))
                .where(
                    CreditLedger.company_id == sub.company_id,
                    CreditLedger.reason == "topup",
                )
            ) or 0

            plan_balance = float(granted) + float(total_used) - float(topup_granted)
            to_expire = max(0.0, plan_balance)

            if to_expire > 0:
                db.add(CreditLedger(
                    company_id=sub.company_id,
                    delta=-to_expire,
                    reason="plan_expiry",
                ))

            # Grant fresh monthly credits
            monthly = billing_svc.TIER_CREDITS.get(sub.tier, sub.monthly_credits)
            db.add(CreditLedger(
                company_id=sub.company_id,
                delta=monthly,
                reason="plan_grant",
            ))
            db.add(AuditLog(
                company_id=sub.company_id,
                action="billing.monthly_credits_reset",
                detail={
                    "tier": sub.tier,
                    "credits_granted": monthly,
                    "credits_expired": to_expire,
                    "anniversary_day": anniversary_day,
                },
            ))

            logger.info(
                "[reset_monthly_credits] company=%s tier=%s expired=%.2f granted=%d",
                sub.company_id, sub.tier, to_expire, monthly,
            )
            reset_count += 1

        db.commit()

    return f"reset_monthly_credits: {reset_count} subscription(s) reset on {today}"
