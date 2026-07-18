"""AI-assisted theme authoring for Developer > Themes > Image Theme, and
the dedicated model settings that power it (Developer > Settings). Three
distinct OpenRouter calls are involved, each using its own developer-
configurable model — deliberately dedicated rather than reusing the
video shot-review model, since these serve a different purpose:

1. TEXT — writes a draft scene-description prompt for a newly-added
   Style/Product tag (Text for Image tab). Reuses one of the developer's
   already-configured TEXT models (Developer > Models), picked here.
2. VISION — looks at an uploaded reference image, suggests which
   existing style/product tags fit (or a brand-new tag name if nothing
   does), and writes a draft prompt. Vision models are a NEW,
   developer-addable list (there's no "vision" kind in the existing
   Models tab), seeded with one working default so this works out of
   the box.
3. IMAGE TRANSFORM — regenerates a NEW, original image inspired by the
   uploaded reference rather than storing/serving the reference itself,
   specifically to avoid copyright issues when the reference was sourced
   from the open web (e.g. Google Images) rather than owned by the
   developer. Reuses one of the developer's already-configured IMAGE
   models (Developer > Models).

Everything here is developer-only/internal — never billed to a company's
credit balance (this isn't part of any company's ad generation).
"""
import base64
import json

from sqlalchemy.orm.attributes import flag_modified

from app.models import ModelConfig
from app.services import credits as credit_svc
from app.services import text_gen
from app.services.images import generate_image
from app.services.storage import upload_data_url
import asyncio

DEFAULT_VISION_MODELS = [
    {"id": "vis-gemini-flash", "label": "Gemini 2.5 Flash (vision)", "model": "google/gemini-2.5-flash"},
]


async def get_theme_ai_settings(db) -> dict:
    row = await db.get(ModelConfig, 1)
    stored = (row.config if row and row.config else {}).get("theme_ai") or {}
    vision_models = stored.get("vision_models") or list(DEFAULT_VISION_MODELS)
    return {
        "text_model_id": stored.get("text_model_id"),
        "vision_model_id": stored.get("vision_model_id") or (vision_models[0]["id"] if vision_models else None),
        "image_transform_model_id": stored.get("image_transform_model_id"),
        "vision_models": vision_models,
    }


async def set_theme_ai_settings(db, text_model_id: str | None, vision_model_id: str | None, image_transform_model_id: str | None) -> dict:
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    theme_ai = dict(config.get("theme_ai") or {})
    theme_ai["text_model_id"] = text_model_id
    theme_ai["vision_model_id"] = vision_model_id
    theme_ai["image_transform_model_id"] = image_transform_model_id
    config["theme_ai"] = theme_ai
    row.config = config
    flag_modified(row, "config")
    await db.commit()
    return await get_theme_ai_settings(db)


async def add_vision_model(db, label: str, model: str) -> dict:
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    theme_ai = dict(config.get("theme_ai") or {})
    vision_models = list(theme_ai.get("vision_models") or DEFAULT_VISION_MODELS)
    new_id = f"vis-{len(vision_models) + 1}-{abs(hash(model)) % 10000}"
    vision_models.append({"id": new_id, "label": label, "model": model})
    theme_ai["vision_models"] = vision_models
    config["theme_ai"] = theme_ai
    row.config = config
    flag_modified(row, "config")
    await db.commit()
    return await get_theme_ai_settings(db)


async def delete_vision_model(db, model_id: str) -> dict:
    row = await db.get(ModelConfig, 1)
    if row is None:
        return await get_theme_ai_settings(db)
    config = dict(row.config or {})
    theme_ai = dict(config.get("theme_ai") or {})
    vision_models = [m for m in (theme_ai.get("vision_models") or DEFAULT_VISION_MODELS) if m["id"] != model_id]
    theme_ai["vision_models"] = vision_models
    if theme_ai.get("vision_model_id") == model_id:
        theme_ai["vision_model_id"] = vision_models[0]["id"] if vision_models else None
    config["theme_ai"] = theme_ai
    row.config = config
    flag_modified(row, "config")
    await db.commit()
    return await get_theme_ai_settings(db)


async def _resolve_model_slug(db, kind: str, model_id: str | None) -> str | None:
    """kind is 'text' or 'image' — looks up the actual OpenRouter model
    slug from the developer's existing Models list (Developer > Models)."""
    if not model_id:
        return None
    models = await credit_svc.get_available_models(db)
    entry = next((m for m in models.get(kind, []) if m["id"] == model_id), None)
    return entry["model"] if entry else None


async def generate_tag_prompt(db, axis: str, tag: str) -> str:
    """Writes a draft scene-description prompt for a newly-added Style or
    Product tag. Draft only — the developer still reviews/edits before
    saving, same as typing it by hand."""
    settings_ = await get_theme_ai_settings(db)
    slug = await _resolve_model_slug(db, "text", settings_["text_model_id"])
    if not slug:
        raise RuntimeError("No text model is set for theme prompt generation — pick one in Developer > Settings first.")

    axis_desc = "a visual style/mood" if axis == "style" else "a product category"
    prompt = (
        f'Write ONE concise, vivid background/scene description (2-3 sentences, no more than ~60 words) for an '
        f'AI ad-image generator, for the theme tag "{tag}" ({axis_desc}). It should describe lighting, setting, '
        f"and mood suitable for a commercial product advertisement in this theme — not the product itself, just "
        f'the surrounding scene/background. Respond ONLY with raw JSON, no markdown fences: {{"prompt": "..."}}'
    )
    result = await asyncio.to_thread(text_gen.generate_text, prompt, slug)
    return (result.get("prompt") or "").strip()


async def analyze_and_transform_image(db, image_data_url: str, style_tags: list[str], category_tags: list[str]) -> dict:
    """The full AI pipeline for an uploaded "Image for Image" reference:
    1. Upload the raw reference privately (needed as a URL for the vision
       call — OpenRouter's chat completions endpoint needs a fetchable
       URL, not a raw upload).
    2. Vision model suggests which existing style/product tags fit (can
       be zero, one, or several per axis) or proposes new tag names.
    3. Image model regenerates a NEW, original image inspired by the
       reference — this is what actually gets stored/served, so a
       reference sourced from the open web never appears verbatim in the
       app (avoids copyright exposure).
    Returns everything as a draft for the developer to review/edit before
    saving — nothing is written to the theme library here."""
    settings_ = await get_theme_ai_settings(db)
    vision_models = settings_["vision_models"]
    vision_entry = next((m for m in vision_models if m["id"] == settings_["vision_model_id"]), None)
    if not vision_entry:
        raise RuntimeError("No vision model is set for theme image analysis — pick one in Developer > Settings first.")
    image_model_slug = await _resolve_model_slug(db, "image", settings_["image_transform_model_id"])
    if not image_model_slug:
        raise RuntimeError("No image model is set for theme image transformation — pick one in Developer > Settings first.")

    raw_url = upload_data_url(image_data_url, prefix="theme-refs-raw")

    vision_prompt = (
        "You are tagging a reference image for an ad-theme library. Existing STYLE tags: "
        f"{json.dumps(style_tags)}. Existing PRODUCT CATEGORY tags: {json.dumps(category_tags)}.\n"
        "Look at the image and decide which of the existing STYLE tags apply (zero or more), which existing "
        "PRODUCT CATEGORY tags apply (zero or more), and if none of the existing tags in an axis genuinely fit, "
        "propose ONE new tag name for that axis (short, 2-4 words, same style as the existing list) instead of "
        "forcing a bad match. Also write a concise 2-3 sentence scene-description prompt for this image suitable "
        "for an AI ad-image generator (background/style, not the product itself).\n"
        'Respond ONLY with raw JSON, no markdown fences: {"matched_style_tags": [...], "matched_category_tags": [...], '
        '"new_style_tag": "..." or null, "new_category_tag": "..." or null, "prompt": "..."}'
    )
    analysis = await asyncio.to_thread(text_gen.analyze_image_with_vision, raw_url, vision_prompt, vision_entry["model"])

    transform_prompt = (
        "Create a new, original commercial product-advertising background/scene image, INSPIRED BY the mood, "
        "color palette, and composition style of the reference image, but rendered as a distinct new image — "
        "do not reproduce the reference directly or copy any specific real-world logos, brands, or identifiable "
        "elements from it. High-end commercial ad photography style, no text overlay, no watermark."
    )
    img_bytes, ext = await asyncio.to_thread(generate_image, transform_prompt, image_model_slug, [raw_url])
    transformed_url = upload_data_url(
        f"data:image/{ext};base64,{base64.b64encode(img_bytes).decode()}",
        prefix="theme-thumbnails",
    )

    return {
        "matched_style_tags": [t for t in (analysis.get("matched_style_tags") or []) if t in style_tags],
        "matched_category_tags": [t for t in (analysis.get("matched_category_tags") or []) if t in category_tags],
        "new_style_tag": (analysis.get("new_style_tag") or "").strip() or None,
        "new_category_tag": (analysis.get("new_category_tag") or "").strip() or None,
        "prompt": (analysis.get("prompt") or "").strip(),
        "thumbnail_url": transformed_url,
    }


async def generate_all_missing_prompts(db, style_tags: list[str], category_tags: list[str]) -> dict:
    """Loops every Style and Product tag that currently has an empty
    prompt in the Text for Image editor and drafts one via the text
    model — the bulk "fill in everything" action, so the developer isn't
    stuck typing 20 prompts by hand after tags accumulate."""
    from app.services import themes as themes_svc  # local import: avoid a circular import at module load time

    editor = await themes_svc.get_image_theme_editor(db)
    text_for_image = editor["text_for_image"]
    filled = 0
    skipped = 0
    for axis, tags in (("style", style_tags), ("product", category_tags)):
        for tag in tags:
            if text_for_image[axis].get(tag, "").strip():
                continue
            try:
                prompt = await generate_tag_prompt(db, axis, tag)
                text_for_image[axis][tag] = prompt
                filled += 1
            except Exception:  # noqa: BLE001 — one bad generation shouldn't stop the rest
                skipped += 1
    saved = await themes_svc.set_image_theme_editor(db, text_for_image, editor["image_for_image"])
    return {"editor": saved, "filled": filled, "skipped": skipped}
