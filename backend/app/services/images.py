"""OpenRouter image generation — uses OpenRouter's dedicated Image API
(POST /api/v1/images). Supports optional reference images (input_references)
for image-to-image editing — this is how the customer's real uploaded
product photo gets composited into the generated scene, rather than the
model generating a fresh, unrelated product from text alone.

Docs: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
"""
import base64
import time

import httpx

from app.config import settings

OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images"


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


def generate_image(prompt: str, model: str, reference_urls: list[str] | None = None) -> tuple[bytes, str]:
    body = {
        "model": model,
        "prompt": prompt,
        "resolution": "1K",
        "aspect_ratio": "1:1",
    }
    if reference_urls:
        body["input_references"] = [
            {"type": "image_url", "image_url": {"url": u}} for u in reference_urls
        ]

    resp = _post_with_retry(
        OPENROUTER_IMAGES_URL,
        headers={
            "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
        },
        json=body,
        timeout=120,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"OpenRouter {resp.status_code}: {resp.text[:500]}")

    payload = resp.json()
    try:
        item = payload["data"][0]
        b64data = item["b64_json"]
        media_type = item.get("media_type", "image/png")
        ext = media_type.split("/")[-1]
        return base64.b64decode(b64data), ext
    except (KeyError, IndexError) as exc:
        raise RuntimeError(
            f"Unexpected OpenRouter image response shape ({exc}). Raw payload: {payload}"
        ) from exc
