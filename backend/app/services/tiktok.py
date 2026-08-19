"""TikTok Content Posting API — OAuth and posting (video + Photo Mode carousel).

OAuth flow (authorization_code grant):
  1. GET  /oauth/authorize          → user consent screen
  2. GET  /callback?code=...        → exchange code for access token
  3. POST /v2/post/publish/video/init   → initialize video upload
  4. PUT  {upload_url}              → upload video bytes
  5. POST /v2/post/publish/video/init   → publish
  OR
  3. POST /v2/post/publish/content/init → Photo Mode carousel

Scopes needed (configured in Developer > Platforms):
  user.info.basic, video.publish, video.upload

NOTE: TikTok uses "Client Key" (not "Client ID") but we store it as
client_id in platform_config for consistency with other platforms.

Photo Mode rules:
  - Min 2 images, max 35
  - If only 1 image is available, duplicate it to meet the minimum
  - Formats: JPEG, WEBP

CLIENT KEY/SECRET are developer-managed in the database
(services/platform_config.py) — never in .env.
"""
import logging
import urllib.parse

import httpx

logger = logging.getLogger("nivaad.tiktok")

# ── API endpoints ─────────────────────────────────────────────────────────────

AUTHORIZE_URL      = "https://www.tiktok.com/v2/auth/authorize/"
TOKEN_URL          = "https://open.tiktokapis.com/v2/oauth/token/"
USERINFO_URL       = "https://open.tiktokapis.com/v2/user/info/"
VIDEO_INIT_URL     = "https://open.tiktokapis.com/v2/post/publish/video/init/"
PHOTO_INIT_URL     = "https://open.tiktokapis.com/v2/post/publish/content/init/"
STATUS_URL         = "https://open.tiktokapis.com/v2/post/publish/status/fetch/"

DEFAULT_SCOPE = "user.info.basic,video.publish,video.upload"

# TikTok video chunk size: max 64 MB per chunk
_CHUNK_SIZE = 64 * 1024 * 1024


# ── OAuth ─────────────────────────────────────────────────────────────────────

def get_authorize_url(client_key: str, redirect_uri: str, scope: str, state: str) -> str:
    params = {
        "client_key": client_key,
        "scope": scope or DEFAULT_SCOPE,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"


def exchange_code_for_token(
    code: str,
    client_key: str,
    client_secret: str,
    redirect_uri: str,
    code_verifier: str | None = None,
) -> dict:
    """Exchange authorization code for access + refresh tokens.
    Returns the full token response dict.
    """
    data = {
        "client_key": client_key,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }
    if code_verifier:
        data["code_verifier"] = code_verifier

    resp = httpx.post(
        TOKEN_URL,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=20,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"TikTok token exchange {resp.status_code}: {resp.text[:400]}")
    body = resp.json()
    if body.get("error"):
        raise RuntimeError(f"TikTok token error: {body.get('error_description', body.get('error'))}")
    return body


def get_user_info(access_token: str) -> dict:
    """Fetch basic user info — validates the token and returns
    {open_id, display_name, avatar_url}."""
    resp = httpx.get(
        USERINFO_URL,
        params={"fields": "open_id,display_name,avatar_url"},
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=20,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"TikTok userinfo {resp.status_code}: {resp.text[:400]}")
    data = resp.json().get("data", {}).get("user", {})
    if not data.get("open_id"):
        raise RuntimeError(f"TikTok userinfo returned no open_id: {resp.text[:200]}")
    return data


# ── Video posting ─────────────────────────────────────────────────────────────

TIKTOK_MIN_SHORT_EDGE = 360  # TikTok rejects videos below 360px on the short edge


def _ensure_tiktok_min_resolution(video_bytes: bytes) -> bytes:
    """Upscale video bytes if the short edge is below TikTok's 360px minimum.

    Uses ffmpeg to probe dimensions and upscale proportionally if needed.
    Returns the original bytes unchanged if already meeting the requirement
    or if ffmpeg is unavailable.
    """
    import subprocess
    import tempfile
    import os

    try:
        with tempfile.TemporaryDirectory(prefix="tiktok_scale_") as tmp:
            src = os.path.join(tmp, "src.mp4")
            dst = os.path.join(tmp, "dst.mp4")
            with open(src, "wb") as f:
                f.write(video_bytes)

            # Probe dimensions
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", src],
                capture_output=True, timeout=15,
            )
            dims = probe.stdout.decode().strip()
            if not dims or "x" not in dims:
                return video_bytes
            w, h = map(int, dims.split("x"))
            short_edge = min(w, h)

            if short_edge >= TIKTOK_MIN_SHORT_EDGE:
                return video_bytes  # already fine

            scale = TIKTOK_MIN_SHORT_EDGE / short_edge
            new_w = int(round(w * scale / 2) * 2)
            new_h = int(round(h * scale / 2) * 2)
            logger.info("[tiktok] upscaling video from %dx%d to %dx%d to meet 360px minimum", w, h, new_w, new_h)

            subprocess.run(
                ["ffmpeg", "-y", "-i", src,
                 "-vf", f"scale={new_w}:{new_h}",
                 "-c:v", "libx264", "-c:a", "copy", dst],
                capture_output=True, timeout=120, check=True,
            )
            with open(dst, "rb") as f:
                return f.read()

    except Exception as exc:
        logger.warning("[tiktok] min-resolution upscale failed, using original: %s", exc)
        return video_bytes


def post_video(
    access_token: str,
    video_url: str,
    caption: str = "",
    privacy_level: str = "SELF_ONLY",  # SELF_ONLY for sandbox testing, PUBLIC_TO_EVERYONE for prod
) -> str:
    """Upload a video from our S3/R2 storage and publish it to TikTok.

    Flow:
      1. Fetch video bytes from storage
      2. POST initializeUpload → get upload_url + publish_id
      3. PUT video bytes to upload_url (chunked if > 64 MB)
      4. Return publish_id (TikTok processes asynchronously)

    Returns the publish_id string.
    """
    from app.services.storage import fetch_bytes as _fetch_bytes

    # Step 1 — fetch from storage
    try:
        video_bytes, content_type = _fetch_bytes(video_url)
    except Exception as exc:
        raise RuntimeError(f"Could not read video from storage: {exc}") from exc

    # TikTok requires a minimum of 360px on the short edge.
    # Upscale here if the reframed video is below that threshold.
    video_bytes = _ensure_tiktok_min_resolution(video_bytes)

    file_size = len(video_bytes)
    logger.info("[tiktok] video upload: size=%d bytes", file_size)

    hdrs = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=UTF-8",
    }

    # Step 2 — initialize upload
    init_body = {
        "post_info": {
            "title": caption[:2200] if caption else "",  # TikTok caption max 2200 chars
            "privacy_level": privacy_level,
            "disable_duet": False,
            "disable_comment": False,
            "disable_stitch": False,
        },
        "source_info": {
            "source": "FILE_UPLOAD",
            "video_size": file_size,
            "chunk_size": min(_CHUNK_SIZE, file_size),
            "total_chunk_count": -(-file_size // min(_CHUNK_SIZE, file_size)),  # ceiling division
        },
    }

    init_resp = httpx.post(VIDEO_INIT_URL, headers=hdrs, json=init_body, timeout=30)
    if init_resp.status_code >= 400:
        raise RuntimeError(f"TikTok video init {init_resp.status_code}: {init_resp.text[:400]}")

    init_data = init_resp.json().get("data", {})
    upload_url = init_data.get("upload_url")
    publish_id = init_data.get("publish_id")

    if not upload_url or not publish_id:
        raise RuntimeError(f"TikTok video init unexpected response: {init_resp.text[:400]}")

    logger.info("[tiktok] video init ok: publish_id=%s", publish_id)

    # Step 3 — upload chunks
    chunk_size = min(_CHUNK_SIZE, file_size)
    chunk_count = -(-file_size // chunk_size)

    for i in range(chunk_count):
        start = i * chunk_size
        end = min(start + chunk_size, file_size)
        chunk = video_bytes[start:end]

        put_resp = httpx.put(
            upload_url,
            content=chunk,
            headers={
                "Content-Type": "video/mp4",
                "Content-Range": f"bytes {start}-{end - 1}/{file_size}",
                "Content-Length": str(len(chunk)),
            },
            timeout=300,
        )
        if put_resp.status_code not in (200, 201, 206):
            raise RuntimeError(
                f"TikTok video chunk {i + 1}/{chunk_count} upload failed "
                f"{put_resp.status_code}: {put_resp.text[:400]}"
            )
        logger.info("[tiktok] chunk %d/%d uploaded (%d-%d)", i + 1, chunk_count, start, end - 1)

    logger.info("[tiktok] video upload complete → publish_id=%s", publish_id)
    return publish_id


# ── Photo Mode (carousel) posting ─────────────────────────────────────────────

def post_photos(
    access_token: str,
    image_urls: list[str],
    caption: str = "",
    privacy_level: str = "SELF_ONLY",
) -> str:
    """Upload images from our S3/R2 storage and publish as a TikTok
    Photo Mode carousel.

    Rules:
      - Min 2 images required by TikTok API
      - If only 1 image_url is provided, duplicate it to meet the minimum
      - Max 35 images (enforced here — caller shouldn't exceed this)

    Returns the publish_id string.
    """
    from app.services.storage import fetch_bytes as _fetch_bytes

    if not image_urls:
        raise RuntimeError("No image URLs provided for TikTok photo post.")

    # Duplicate single image to meet TikTok's 2-image minimum
    if len(image_urls) == 1:
        image_urls = [image_urls[0], image_urls[0]]
        logger.info("[tiktok] single image duplicated to meet 2-image minimum")

    # Cap at 35
    image_urls = image_urls[:35]

    # Fetch all images from storage
    images: list[tuple[bytes, str]] = []
    for url in image_urls:
        try:
            img_bytes, content_type = _fetch_bytes(url)
            images.append((img_bytes, content_type))
        except Exception as exc:
            raise RuntimeError(f"Could not read image from storage ({url}): {exc}") from exc

    logger.info("[tiktok] photo post: %d images", len(images))

    hdrs = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=UTF-8",
    }

    # TikTok PULL_FROM_URL: photo_images must be a plain list of URL strings,
    # NOT a list of objects — sending {"url": "..."} objects causes error
    # "The request parameter type is incorrect" (invalid_params 400).
    init_body = {
        "post_info": {
            "title": caption[:2200] if caption else "",
            "privacy_level": privacy_level,
            "disable_comment": False,
        },
        "source_info": {
            "source": "PULL_FROM_URL",
            "photo_images": image_urls,
            "photo_cover_index": 0,
        },
        "post_mode": "DIRECT_POST",
        "media_type": "PHOTO",
    }

    init_resp = httpx.post(PHOTO_INIT_URL, headers=hdrs, json=init_body, timeout=30)
    if init_resp.status_code >= 400:
        raise RuntimeError(f"TikTok photo init {init_resp.status_code}: {init_resp.text[:400]}")

    init_data = init_resp.json().get("data", {})
    publish_id = init_data.get("publish_id")

    if not publish_id:
        raise RuntimeError(f"TikTok photo init unexpected response: {init_resp.text[:400]}")

    logger.info("[tiktok] photo post ok → publish_id=%s", publish_id)
    return publish_id


# ── Main entry point (called from tasks.py) ───────────────────────────────────

def post_to_tiktok(
    access_token: str,
    caption: str,
    image_url: str | None = None,
    video_url: str | None = None,
    extra_image_urls: list[str] | None = None,
    privacy_level: str = "SELF_ONLY",
) -> str:
    """Post to TikTok. Video takes priority over images.

    - video_url set   → post as video
    - image_url set   → post as Photo Mode carousel
      (extra_image_urls adds more slides; single image is duplicated)
    - neither set     → raises RuntimeError

    Returns publish_id.
    """
    if video_url:
        logger.info("[tiktok] posting video")
        return post_video(access_token, video_url, caption, privacy_level)

    if image_url:
        all_images = [image_url] + (extra_image_urls or [])
        logger.info("[tiktok] posting %d image(s) as photo carousel", len(all_images))
        return post_photos(access_token, all_images, caption, privacy_level)

    raise RuntimeError("post_to_tiktok called with neither image_url nor video_url.")
