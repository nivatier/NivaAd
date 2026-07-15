"""Composites the company's brand logo onto a generated ad image, at the
corner they chose in Brand Kit settings. This is what makes the Brand
Kit's logo actually appear ON the ad, not just referenced in the UI.
"""
import io
import logging

from PIL import Image

logger = logging.getLogger("nivaad.branding")

PADDING_RATIO = 0.03      # gap from the edge, as a fraction of the image's shorter side
LOGO_WIDTH_RATIO = 0.14   # logo width, as a fraction of the image width


def composite_logo(image_bytes: bytes, logo_bytes: bytes, placement: str = "bottom-right") -> bytes:
    """Returns new PNG bytes with the logo pasted onto the image. Falls back
    to the original image bytes (logged, not raised) if anything about the
    logo file is unreadable — a bad logo should never break ad generation."""
    try:
        base = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        logo = Image.open(io.BytesIO(logo_bytes)).convert("RGBA")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not open image/logo for compositing: %s", exc)
        return image_bytes

    bw, bh = base.size
    padding = int(min(bw, bh) * PADDING_RATIO)

    logo_w = max(24, int(bw * LOGO_WIDTH_RATIO))
    logo_h = max(24, int(logo_w * logo.size[1] / logo.size[0]))
    logo = logo.resize((logo_w, logo_h), Image.LANCZOS)

    positions = {
        "top-left": (padding, padding),
        "top-right": (bw - logo_w - padding, padding),
        "bottom-left": (padding, bh - logo_h - padding),
        "bottom-right": (bw - logo_w - padding, bh - logo_h - padding),
    }
    x, y = positions.get(placement, positions["bottom-right"])

    base.alpha_composite(logo, (x, y))

    out = io.BytesIO()
    base.convert("RGB").save(out, format="PNG")
    return out.getvalue()
