"""OpenRouter video generation — uses OpenRouter's video API
(POST /api/v1/videos). Unlike image generation, this is asynchronous:
submit a job, poll until it completes, then download the result. Video
generation genuinely takes anywhere from 30 seconds to several minutes,
so this runs inside a Celery task (which can run long) rather than a
synchronous request handler.

Docs: https://openrouter.ai/docs/guides/overview/multimodal/video-generation
"""
import base64
import io
import logging
import time

import httpx
from PIL import Image

from app.config import settings

logger = logging.getLogger("nivaad.videos")

OPENROUTER_VIDEOS_URL = "https://openrouter.ai/api/v1/videos"

# Bounded so a stuck/slow job can't tie up a Celery worker forever —
# generous relative to OpenRouter's own "30 seconds to several minutes"
# guidance, with a clear timeout error rather than hanging indefinitely.
MAX_WAIT_SECONDS = 480
POLL_INTERVAL_SECONDS = 10


def _post_with_retry(url: str, **kwargs) -> httpx.Response:
    last_exc = None
    for attempt in range(3):
        try:
            return httpx.post(url, **kwargs)
        except (httpx.ConnectError, httpx.TransportError) as exc:
            last_exc = exc
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    raise last_exc


def _prepare_frame_image(data_url: str) -> str:
    """Video frame images have real constraints, confirmed across
    multiple independent sources documenting this model family's actual
    API requirements: minimum 300x300px, maximum 10MB, aspect ratio
    between 1:2.5 and 2.5:1 (width/height between 0.4 and 2.5), opaque
    JPG/PNG only.

    Handles all of these, not just the one (transparency) that was
    tried first:
      - Transparency: flattened onto a plain white background — a
        transparent product cutout (very common for uploaded product
        photos) is otherwise rejected outright as an invalid starting
        frame.
      - Aspect ratio: PADDED (not cropped) with a plain white border to
        bring it within 0.4-2.5 — a tall, narrow product shot (e.g. a
        bottle) very plausibly falls outside this range as photographed,
        and cropping to fix it would cut off part of the product, which
        this codebase treats as unacceptable elsewhere (see
        _image_prompt's own framing rule) — padding preserves the whole
        product instead.
      - Minimum size: upscaled if either dimension is under 300px.
      - File size: JPEG quality is stepped down if still over 10MB
        after the above.

    Falls back to the original, unmodified data URL if anything about
    the image is unreadable — a processing hiccup here should never be
    what blocks video generation; better to attempt the original than
    fail outright."""
    MIN_DIM = 300
    MAX_BYTES = 10 * 1024 * 1024
    MIN_RATIO, MAX_RATIO = 0.4, 2.5

    try:
        header, b64data = data_url.split(",", 1)
        raw = base64.b64decode(b64data)
        img = Image.open(io.BytesIO(raw))

        # 1. Flatten transparency onto white.
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            background = Image.new("RGB", img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[-1])  # use alpha channel as the paste mask
            img = background
        else:
            img = img.convert("RGB")

        # 2. Upscale if below the minimum dimension in either direction.
        w, h = img.size
        if w < MIN_DIM or h < MIN_DIM:
            scale = max(MIN_DIM / w, MIN_DIM / h)
            img = img.resize((max(MIN_DIM, round(w * scale)), max(MIN_DIM, round(h * scale))), Image.LANCZOS)
            w, h = img.size

        # 3. Pad (never crop) if the aspect ratio falls outside what's
        # accepted — adds a plain white border on the short axis rather
        # than cutting anything off the product.
        ratio = w / h
        if ratio < MIN_RATIO:
            new_w = round(h * MIN_RATIO)
            canvas = Image.new("RGB", (new_w, h), (255, 255, 255))
            canvas.paste(img, ((new_w - w) // 2, 0))
            img = canvas
        elif ratio > MAX_RATIO:
            new_h = round(w / MAX_RATIO)
            canvas = Image.new("RGB", (w, new_h), (255, 255, 255))
            canvas.paste(img, (0, (new_h - h) // 2))
            img = canvas

        # 4. Encode, stepping quality down if still over the size limit.
        quality = 92
        while True:
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=quality)
            if out.tell() <= MAX_BYTES or quality <= 40:
                break
            quality -= 15

        new_b64 = base64.b64encode(out.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{new_b64}"
    except Exception as exc:  # noqa: BLE001
        logger.warning("[video] could not sanitize frame image, using original: %s", exc)
        return data_url


def generate_video(prompt: str, model: str, duration: int = 6, resolution: str = "720p", frame_image_url: str | None = None) -> bytes:
    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    body = {"model": model, "prompt": prompt, "duration": duration, "resolution": resolution}
    if frame_image_url:
        # Image-to-video: animate starting from the customer's actual
        # product photo, same spirit as how image generation uses it as
        # a reference — the video opens on the real product, not a
        # generic AI-imagined one. Sanitized first (see _prepare_frame_image)
        # since a transparent PNG reliably fails here even though the
        # same file works fine as an image-generation reference.
        safe_frame_url = _prepare_frame_image(frame_image_url) if frame_image_url.startswith("data:") else frame_image_url
        body["frame_images"] = [{"type": "image_url", "image_url": {"url": safe_frame_url}, "frame_type": "first_frame"}]

    submit_resp = _post_with_retry(OPENROUTER_VIDEOS_URL, headers=headers, json=body, timeout=30)
    if submit_resp.status_code >= 400:
        raise RuntimeError(f"OpenRouter video submit {submit_resp.status_code}: {submit_resp.text[:500]}")
    job = submit_resp.json()
    polling_url = job.get("polling_url") or f"{OPENROUTER_VIDEOS_URL}/{job['id']}"

    elapsed = 0
    while elapsed < MAX_WAIT_SECONDS:
        time.sleep(POLL_INTERVAL_SECONDS)
        elapsed += POLL_INTERVAL_SECONDS

        poll_resp = httpx.get(polling_url, headers=headers, timeout=30)
        if poll_resp.status_code >= 400:
            raise RuntimeError(f"OpenRouter video poll {poll_resp.status_code}: {poll_resp.text[:500]}")
        status = poll_resp.json()

        if status["status"] == "completed":
            content_url = status["unsigned_urls"][0]
            video_resp = httpx.get(content_url, headers=headers, timeout=60)
            if video_resp.status_code >= 400:
                raise RuntimeError(f"OpenRouter video download {video_resp.status_code}: {video_resp.text[:500]}")
            return video_resp.content
        if status["status"] in ("failed", "cancelled", "expired"):
            raise RuntimeError(status.get("error") or f"Video generation {status['status']}")
        # "pending" or "in_progress" — keep polling

    raise RuntimeError(f"Video generation timed out after {MAX_WAIT_SECONDS}s — the job may still complete on OpenRouter's side, but NivaAd stopped waiting.")

