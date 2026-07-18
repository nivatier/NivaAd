"""Developer-managed Create Ad theme library — both the "Text Theme
Reference" chips and the "Image Theme Reference" gallery. Stored in the
existing ModelConfig(id=1) JSON blob under a "themes" key, the same
pattern already used for pricing_config and the model lists (see
services/pricing.py) — no migration needed, and it can be bulk-edited
as raw JSON the same way Developer > Models already is.

Falls back to the original built-in theme set until the developer saves
their own list, so nothing breaks on a fresh deployment.
"""
from sqlalchemy.orm.attributes import flag_modified

from app.models import ModelConfig

# Two independent tag axes, multi-select on each theme: STYLE (the visual
# mood/aesthetic) and CATEGORY (what kind of product it suits). These are
# the developer-editable defaults — saving a custom list via the raw
# themes endpoint replaces them, same "replace, don't silently drop"
# behavior as the model list.
DEFAULT_STYLE_TAGS = [
    "Neon / Cyberpunk", "Minimal / Studio", "Autumn", "Winter / Festive",
    "Summer / Bright", "Luxury / Premium", "Nature / Outdoor", "Urban / Street",
    "Pastel / Soft", "Dark / Moody",
]
DEFAULT_CATEGORY_TAGS = [
    "Cosmetics & Skincare", "Fashion & Apparel", "Food & Beverage", "Tech & Gadgets",
    "Fitness & Sports", "Home & Lifestyle", "Jewelry & Accessories", "Health & Wellness",
    "Automotive", "General / Any product",
]

# Text-overlay style presets — how the Headline/Discount badge/Body text
# actually LOOKS when rendered onto the AI-generated image (font style,
# text color, an accent/outline color for contrast, and a size tier).
# Since this is an AI image-generation prompt, not real typography, these
# get turned into a descriptive phrase (see build_style_phrase below) and
# folded into the generation prompt for whichever field the user applies
# them to. "standard" is the default/no-override option — the AI decides
# based on the background, matching the original (pre-preset) behavior.
DEFAULT_TEXT_STYLE_PRESETS = [
    {"id": "standard", "label": "Standard (fits the image)", "font_style": "", "text_color": "", "accent_color": "", "size": ""},
    {"id": "bold-white-black", "label": "Bold White on Black", "font_style": "Bold sans-serif", "text_color": "#FFFFFF", "accent_color": "#000000", "size": "large"},
    {"id": "elegant-gold", "label": "Elegant Gold", "font_style": "Elegant serif script", "text_color": "#D4AF37", "accent_color": "#1A1A1A", "size": "medium"},
    {"id": "neon-glow", "label": "Neon Glow", "font_style": "Bold condensed sans-serif with a glow effect", "text_color": "#00F0FF", "accent_color": "#FF00E5", "size": "large"},
]

SIZE_DESCRIPTIONS = {"small": "small, subtle", "medium": "medium-sized, clearly legible", "large": "large, attention-grabbing", "xlarge": "extra-large, dominant"}


def build_style_phrase(preset: dict) -> str:
    """Turns a structured preset into the descriptive phrase folded into
    the generation prompt. Empty preset (the "standard" default) returns
    "" so the field's own built-in style_hint is used unchanged."""
    if not preset or not (preset.get("font_style") or preset.get("text_color")):
        return ""
    parts = []
    size = SIZE_DESCRIPTIONS.get(preset.get("size", ""), "")
    if size:
        parts.append(size)
    if preset.get("font_style"):
        parts.append(preset["font_style"].lower())
    phrase = " ".join(parts) or "styled"
    color_bits = []
    if preset.get("text_color"):
        color_bits.append(f"text color {preset['text_color']}")
    if preset.get("accent_color"):
        color_bits.append(f"accent/outline/background color {preset['accent_color']} for contrast")
    color_phrase = f", {', '.join(color_bits)}" if color_bits else ""
    return f"rendered in a {phrase} font{color_phrase}"

DEFAULT_TEXT_THEMES = [
    {
        "id": "studio", "label": "Studio",
        "style_tags": ["Minimal / Studio"], "category_tags": ["General / Any product"],
        "scene_prompt": "Minimalist studio background, seamless neutral backdrop (soft grey or white), soft even top lighting with a subtle shadow beneath the product, clean and professional product-photography look.",
        "placement_prompt": "Place the product centered on a seamless neutral studio backdrop (soft grey or white), soft even top lighting with a subtle contact shadow beneath it, clean professional product-photography look.",
    },
    {
        "id": "lifestyle", "label": "Lifestyle / in use",
        "style_tags": ["Pastel / Soft"], "category_tags": ["General / Any product", "Health & Wellness", "Fitness & Sports"],
        "scene_prompt": "Realistic lifestyle setting showing the product naturally in use in an everyday moment, candid and warm, natural window light, shallow depth of field with a softly blurred background.",
        "placement_prompt": "Place the product naturally into a realistic everyday lifestyle scene as if genuinely in use, candid and warm, natural window light, background softly blurred so the product stays the focus.",
    },
    {
        "id": "outdoor", "label": "Outdoor / nature",
        "style_tags": ["Nature / Outdoor", "Summer / Bright"], "category_tags": ["Fitness & Sports", "General / Any product"],
        "scene_prompt": "Outdoor natural setting — soft daylight, greenery or open sky in the background, gentle natural shadows, airy and fresh mood, background softly out of focus.",
        "placement_prompt": "Place the product in an outdoor natural setting — soft daylight, greenery or open sky behind it, gentle natural shadows, background softly out of focus, airy fresh mood.",
    },
    {
        "id": "home", "label": "Home setting",
        "style_tags": ["Pastel / Soft", "Autumn"], "category_tags": ["Home & Lifestyle", "General / Any product"],
        "scene_prompt": "Cozy home interior background — warm, inviting light, tasteful modern furniture and decor softly out of focus, natural indoor lighting, lived-in but tidy atmosphere.",
        "placement_prompt": "Place the product in a cozy home interior — warm inviting light, tasteful modern furniture and decor softly out of focus behind it, natural indoor lighting.",
    },
    {
        "id": "luxury", "label": "Luxury / premium",
        "style_tags": ["Luxury / Premium", "Dark / Moody"], "category_tags": ["Jewelry & Accessories", "Cosmetics & Skincare", "Automotive"],
        "scene_prompt": "Premium, high-end presentation — dark or richly textured background (marble, velvet, or brushed metal), dramatic directional lighting, elegant reflections, upscale editorial mood.",
        "placement_prompt": "Place the product against a premium high-end backdrop (dark marble, velvet, or brushed metal), dramatic directional lighting, elegant reflections, upscale editorial mood.",
    },
    {
        "id": "festive", "label": "Festive / seasonal",
        "style_tags": ["Winter / Festive"], "category_tags": ["General / Any product", "Food & Beverage"],
        "scene_prompt": "Festive seasonal backdrop with tasteful holiday-appropriate decor and warm bokeh lights in the background, cozy celebratory mood, soft glowing lighting.",
        "placement_prompt": "Place the product in front of a festive seasonal backdrop with tasteful holiday-appropriate decor and warm bokeh lights behind it, cozy celebratory mood.",
    },
]

STANDARD_TEXT_FIELDS = [
    {
        "key": "headline", "label": "Headline", "placeholder": "e.g. MEGA SALE", "default_position": "top-left",
        "style_hint": "large bold advertising headline typography, thick sans-serif or bold script font as commonly used on ad banners, strong color contrast against the background so it pops, clean crisp edges, no clutter behind it",
    },
    {
        "key": "badge", "label": "Discount badge", "placeholder": "e.g. UP TO 50% OFF", "default_position": "middle-right",
        "style_hint": "styled like a real promotional discount sticker/badge — bold circular or starburst badge shape with a solid contrasting fill color, bold white or dark numerals, sized to grab attention like a sale-tag callout",
    },
    {
        "key": "body", "label": "Body / about text", "placeholder": "e.g. short brand or offer description", "default_position": "bottom-left",
        "style_hint": "smaller clean sans-serif supporting/caption text, standard ad-copy weight (not bold), legible against the background, laid out like a short marketing tagline under a headline",
    },
]

DEFAULT_IMAGE_THEMES = [
    {
        "id": "neon-motion", "label": "Neon Motion", "thumbnail": "/themes/neon-motion.jpg",
        "style_tags": ["Neon / Cyberpunk", "Urban / Street"],
        "category_tags": ["Fashion & Apparel", "Tech & Gadgets"],
        "base_prompt": "Dynamic neon night-city scene — the product floating/suspended mid-air over a dark asphalt street, streaked motion-blur light trails in electric blue, magenta and purple racing past in the background, glowing neon signage softly out of focus, dramatic rim lighting on the product edges, cinematic high-energy commercial look, shallow depth of field.",
        "text_fields": STANDARD_TEXT_FIELDS,
    },
    {
        "id": "sale-podium", "label": "Sale Banner — Podium", "thumbnail": "/themes/sale-podium.jpg",
        "style_tags": ["Minimal / Studio", "Pastel / Soft"],
        "category_tags": ["Cosmetics & Skincare", "General / Any product"],
        "base_prompt": "Clean commercial product-banner scene — the product placed on a glossy cylindrical podium/pedestal, soft studio gradient background (two-tone split panel), gentle floating spheres/particles for depth, soft shadow beneath the product, bright airy e-commerce sale-banner look.",
        "text_fields": [
            {
                "key": "headline", "label": "Headline", "placeholder": "e.g. MEGA SALE", "default_position": "top-left",
                "style_hint": "large bold advertising headline typography, thick sans-serif or bold script font as commonly used on ad banners, strong color contrast against the background so it pops, clean crisp edges, no clutter behind it",
            },
            {
                "key": "badge", "label": "Discount badge", "placeholder": "e.g. UP TO 50% OFF", "default_position": "middle-right",
                "style_hint": "styled like a real promotional discount sticker/badge — bold circular or starburst badge shape with a solid contrasting fill color, bold white or dark numerals, sized to grab attention like a sale-tag callout",
            },
            {
                "key": "body", "label": "Body / about text", "placeholder": "e.g. short brand or offer description", "default_position": "bottom-left",
                "style_hint": "smaller clean sans-serif supporting/caption text, standard ad-copy weight (not bold), legible against the background, laid out like a short marketing tagline under a headline",
            },
        ],
    },
]


async def get_themes(db) -> dict:
    row = await db.get(ModelConfig, 1)
    stored = (row.config if row and row.config else {}).get("themes") or {}
    image_themes = stored.get("image_themes", DEFAULT_IMAGE_THEMES)
    # Backfill: every Image Theme Reference should offer the standard
    # Headline/Discount badge/Body fields, including ones saved before
    # that became standard.
    for t in image_themes:
        if not t.get("text_fields"):
            t["text_fields"] = STANDARD_TEXT_FIELDS
    return {
        "image_themes": image_themes,
        "text_themes": stored.get("text_themes", DEFAULT_TEXT_THEMES),
        "style_tags": stored.get("style_tags", DEFAULT_STYLE_TAGS),
        "category_tags": stored.get("category_tags", DEFAULT_CATEGORY_TAGS),
    }


async def set_themes(db, themes: dict) -> dict:
    """Replaces the entire themes blob at once — same all-or-nothing save
    as the raw model list editor, so a malformed paste can't partially
    corrupt what's stored."""
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    config["themes"] = themes
    row.config = config
    flag_modified(row, "config")
    await db.commit()
    return await get_themes(db)


async def get_text_style_presets(db) -> list[dict]:
    row = await db.get(ModelConfig, 1)
    stored = (row.config if row and row.config else {}).get("themes") or {}
    return stored.get("text_style_presets") or list(DEFAULT_TEXT_STYLE_PRESETS)


async def _save_text_style_presets(db, presets: list[dict]) -> list[dict]:
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    themes = dict(config.get("themes") or {})
    themes["text_style_presets"] = presets
    config["themes"] = themes
    row.config = config
    flag_modified(row, "config")
    await db.commit()
    return await get_text_style_presets(db)


async def add_text_style_preset(db, label: str, font_style: str, text_color: str, accent_color: str, size: str) -> list[dict]:
    presets = await get_text_style_presets(db)
    new_id = f"style-{abs(hash(label + font_style)) % 100000}"
    presets.append({"id": new_id, "label": label, "font_style": font_style, "text_color": text_color, "accent_color": accent_color, "size": size})
    return await _save_text_style_presets(db, presets)


async def update_text_style_preset(db, preset_id: str, label: str, font_style: str, text_color: str, accent_color: str, size: str) -> list[dict]:
    presets = await get_text_style_presets(db)
    for p in presets:
        if p["id"] == preset_id:
            p.update({"label": label, "font_style": font_style, "text_color": text_color, "accent_color": accent_color, "size": size})
            break
    else:
        raise ValueError(f'No text style preset with id "{preset_id}".')
    return await _save_text_style_presets(db, presets)


async def delete_text_style_preset(db, preset_id: str) -> list[dict]:
    if preset_id == "standard":
        raise ValueError('The "Standard (fits the image)" preset can\'t be deleted — it\'s the default fallback.')
    presets = [p for p in await get_text_style_presets(db) if p["id"] != preset_id]
    return await _save_text_style_presets(db, presets)


# ---------------------------------------------------------------------------
# Image Theme editor (Developer > Themes > Image Theme tab) — a decomposed,
# fully visual editing model. Rather than one theme entry carrying a mix of
# style + category tags (the flat list above, still used by the Text Themes
# tab and by the older Image Theme Reference gallery in Create Ad), this
# gives every individual STYLE tag and every individual PRODUCT CATEGORY tag
# its own editable prompt — one for text-only generation (no reference
# photo) and one for image-reference generation (with a thumbnail). The
# developer clicks a tag on the left, edits its prompt on the right; no JSON
# is ever shown. Storage is still the same ModelConfig JSON blob underneath
# (under "image_theme_editor") — only the developer-facing UI changed.
# ---------------------------------------------------------------------------

def _seed_image_theme_editor() -> dict:
    text_style = {tag: "" for tag in DEFAULT_STYLE_TAGS}
    text_style["Minimal / Studio"] = (
        "Minimalist studio background, seamless neutral backdrop (soft grey or white), soft even top lighting "
        "with a subtle shadow beneath the product, clean and professional product-photography look."
    )
    text_style["Neon / Cyberpunk"] = (
        "Dynamic neon night-city scene — the product floating/suspended mid-air over a dark asphalt street, "
        "streaked motion-blur light trails in electric blue, magenta and purple racing past in the background, "
        "glowing neon signage softly out of focus, dramatic rim lighting on the product edges, cinematic "
        "high-energy commercial look, shallow depth of field."
    )
    text_product = {tag: "" for tag in DEFAULT_CATEGORY_TAGS}
    text_product["Cosmetics & Skincare"] = (
        "Clean commercial product-banner scene — the product placed on a glossy cylindrical podium/pedestal, "
        "soft studio gradient background (two-tone split panel), gentle floating spheres/particles for depth, "
        "soft shadow beneath the product, bright airy e-commerce sale-banner look."
    )

    image_style = {tag: {"thumbnail": "", "prompt": ""} for tag in DEFAULT_STYLE_TAGS}
    image_style["Neon / Cyberpunk"] = {"thumbnail": "/themes/neon-motion.jpg", "prompt": text_style["Neon / Cyberpunk"]}
    image_style["Minimal / Studio"] = {"thumbnail": "/themes/sale-podium.jpg", "prompt": text_product["Cosmetics & Skincare"]}
    image_product = {tag: {"thumbnail": "", "prompt": ""} for tag in DEFAULT_CATEGORY_TAGS}
    image_product["Cosmetics & Skincare"] = {"thumbnail": "/themes/sale-podium.jpg", "prompt": text_product["Cosmetics & Skincare"]}

    return {
        "text_for_image": {"style": text_style, "product": text_product},
        "image_for_image": {"style": image_style, "product": image_product},
    }


async def get_image_theme_editor(db) -> dict:
    row = await db.get(ModelConfig, 1)
    stored = (row.config if row and row.config else {}).get("themes") or {}
    style_tags = stored.get("style_tags", DEFAULT_STYLE_TAGS)
    category_tags = stored.get("category_tags", DEFAULT_CATEGORY_TAGS)
    editor = stored.get("image_theme_editor")
    if editor is None:
        editor = _seed_image_theme_editor()

    # Merge-don't-replace: any tag added to the master list since this was
    # last saved gets an empty slot instead of silently not appearing.
    def _ensure_keys(d: dict, keys: list[str], empty):
        for k in keys:
            if k not in d:
                d[k] = empty() if callable(empty) else empty
        return d

    text_for_image = editor.get("text_for_image", {"style": {}, "product": {}})
    text_for_image["style"] = _ensure_keys(dict(text_for_image.get("style", {})), style_tags, lambda: "")
    text_for_image["product"] = _ensure_keys(dict(text_for_image.get("product", {})), category_tags, lambda: "")

    image_for_image = editor.get("image_for_image", {"style": {}, "product": {}})
    image_for_image["style"] = _ensure_keys(dict(image_for_image.get("style", {})), style_tags, lambda: {"thumbnail": "", "prompt": ""})
    image_for_image["product"] = _ensure_keys(dict(image_for_image.get("product", {})), category_tags, lambda: {"thumbnail": "", "prompt": ""})

    return {
        "style_tags": style_tags,
        "category_tags": category_tags,
        "text_for_image": text_for_image,
        "image_for_image": image_for_image,
    }


async def set_image_theme_editor(db, text_for_image: dict, image_for_image: dict) -> dict:
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    themes = dict(config.get("themes") or {})
    themes["image_theme_editor"] = {"text_for_image": text_for_image, "image_for_image": image_for_image}
    themes.setdefault("style_tags", DEFAULT_STYLE_TAGS)
    themes.setdefault("category_tags", DEFAULT_CATEGORY_TAGS)
    themes.setdefault("text_themes", DEFAULT_TEXT_THEMES)
    themes.setdefault("image_themes", DEFAULT_IMAGE_THEMES)
    config["themes"] = themes
    row.config = config
    flag_modified(row, "config")
    await db.commit()
    return await get_image_theme_editor(db)


async def add_theme_tag(db, axis: str, tag: str) -> dict:
    """Adds a brand-new Style or Product Category tag to the master list —
    it immediately gets an empty prompt slot in the editor (merge-don't-
    replace), ready for the developer to fill in."""
    if axis not in ("style", "category"):
        raise ValueError('axis must be "style" or "category"')
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    themes = dict(config.get("themes") or {})
    key = "style_tags" if axis == "style" else "category_tags"
    current = list(themes.get(key, DEFAULT_STYLE_TAGS if axis == "style" else DEFAULT_CATEGORY_TAGS))
    if tag not in current:
        current.append(tag)
    themes[key] = current
    config["themes"] = themes
    row.config = config
    flag_modified(row, "config")
    await db.commit()
    return await get_image_theme_editor(db)
