"""LinkedIn OAuth (3-legged, authorization_code grant) and the real
Posts API — verified against LinkedIn's current documented endpoints.

Image posting flow (3 steps):
  1. POST /rest/images?action=initializeUpload  → uploadUrl + image URN
  2. PUT {uploadUrl} with raw image bytes        → 201 No Content
  3. POST /rest/posts with content.media block  → post URN in x-restli-id header

Text-only posting falls through to step 3 with no content.media block.

SCOPE CAVEAT: LinkedIn draws a hard line between posting to a PERSONAL
profile (w_member_social — self-serve, no approval needed) and to a
COMPANY PAGE (w_organization_social — requires LinkedIn's Community
Management API approval). The scope is developer-configured in
Developer > Platforms; author URN uses urn:li:person:{id} for personal.

CLIENT ID/SECRET are developer-managed in the database (see
services/platform_config.py) — not read from .env.
"""
import urllib.parse

import httpx

AUTHORIZE_URL   = "https://www.linkedin.com/oauth/v2/authorization"
TOKEN_URL       = "https://www.linkedin.com/oauth/v2/accessToken"
USERINFO_URL    = "https://api.linkedin.com/v2/userinfo"
POSTS_URL       = "https://api.linkedin.com/rest/posts"
IMAGES_URL      = "https://api.linkedin.com/rest/images"
VIDEOS_URL      = "https://api.linkedin.com/rest/videos"

LINKEDIN_API_VERSION = "202501"  # YYYYMM fallback — override via Developer > Platforms > API Version
# Active versions as of mid-2025: 202501, 202504, 202607
# Never use a future/unreleased month — LinkedIn returns 426 NONEXISTENT_VERSION.
DEFAULT_SCOPE = "openid profile w_member_social"


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_linkedin_platform(db=None) -> dict:
    """Return the stored platform config for LinkedIn (sync DB only)."""
    if db is None:
        return {}
    try:
        from app.services.platform_config import get_platform_integrations_sync
        for p in get_platform_integrations_sync(db):
            if p.get("id") in ("linkedin_personal", "linkedin_company", "linkedin"):
                return p
    except Exception:
        pass
    return {}


def _get_posts_url(db=None) -> str:
    p = _get_linkedin_platform(db)
    return p.get("api_url") or POSTS_URL


def _get_api_version(db=None) -> str:
    p = _get_linkedin_platform(db)
    return (p.get("api_version") or "").strip() or LINKEDIN_API_VERSION


def _get_authorize_url(db=None) -> str:
    p = _get_linkedin_platform(db)
    return p.get("authorize_url") or AUTHORIZE_URL


def _get_token_url(db=None) -> str:
    p = _get_linkedin_platform(db)
    return p.get("token_url") or TOKEN_URL


def _get_userinfo_url(db=None) -> str:
    p = _get_linkedin_platform(db)
    return p.get("userinfo_url") or USERINFO_URL


def _get_images_url(db=None) -> str:
    p = _get_linkedin_platform(db)
    return p.get("images_url") or IMAGES_URL


def _get_videos_url(db=None) -> str:
    p = _get_linkedin_platform(db)
    return p.get("videos_url") or VIDEOS_URL


def _headers(access_token: str, version: str) -> dict:
    return {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": version,
    }


# ── OAuth helpers ─────────────────────────────────────────────────────────────

def get_authorize_url(client_id: str, redirect_uri: str, scope: str, state: str) -> str:
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "scope": scope or DEFAULT_SCOPE,
    }
    return f"{_get_authorize_url()}?{urllib.parse.urlencode(params)}"


def exchange_code_for_token(code: str, client_id: str, client_secret: str, redirect_uri: str) -> dict:
    """Returns {access_token, expires_in, refresh_token?}."""
    resp = httpx.post(
        _get_token_url(),
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=20,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"LinkedIn token exchange {resp.status_code}: {resp.text[:400]}")
    return resp.json()


def get_person_urn(access_token: str, db=None) -> str:
    """OpenID Connect userinfo — 'sub' is used as the person's URN."""
    resp = httpx.get(_get_userinfo_url(db), headers={"Authorization": f"Bearer {access_token}"}, timeout=20)
    if resp.status_code >= 400:
        raise RuntimeError(f"LinkedIn userinfo {resp.status_code}: {resp.text[:400]}")
    sub = resp.json().get("sub")
    if not sub:
        raise RuntimeError(f"LinkedIn userinfo response had no 'sub' claim: {resp.text[:400]}")
    return f"urn:li:person:{sub}"


# ── Image upload ──────────────────────────────────────────────────────────────

def upload_image_to_linkedin(
    access_token: str,
    author_urn: str,
    image_url: str,
    version: str,
) -> str:
    """Download image from our S3/R2 storage and upload to LinkedIn.

    Returns the LinkedIn image URN (e.g. urn:li:image:C5600...) which
    is then referenced in the post body's content.media block.

    Uses storage.fetch_bytes() to read via the internal S3 endpoint
    (container-to-container) rather than the public HTTP URL — this
    avoids "Connection refused" errors when the public URL is localhost
    in local development.

    Steps:
      1. Fetch image bytes from our S3/MinIO via boto3
      2. POST initializeUpload → get LinkedIn uploadUrl + image URN
      3. PUT image bytes to uploadUrl
    """
    from app.services.storage import fetch_bytes as _fetch_bytes

    # Step 1 — read from storage via internal S3 connection (works in all envs)
    try:
        image_bytes, content_type = _fetch_bytes(image_url)
    except Exception as exc:
        raise RuntimeError(f"Could not read image from storage: {exc}") from exc

    hdrs = _headers(access_token, version)

    # Step 2 — initialize upload
    init_resp = httpx.post(
        f"{_get_images_url()}?action=initializeUpload",
        headers=hdrs,
        json={"initializeUploadRequest": {"owner": author_urn}},
        timeout=30,
    )
    if init_resp.status_code >= 400:
        raise RuntimeError(f"LinkedIn initializeUpload {init_resp.status_code}: {init_resp.text[:400]}")

    init_data = init_resp.json().get("value", {})
    upload_url = init_data.get("uploadUrl")
    image_urn  = init_data.get("image")

    if not upload_url or not image_urn:
        raise RuntimeError(f"LinkedIn initializeUpload returned unexpected shape: {init_resp.text[:400]}")

    # Step 3 — PUT binary to LinkedIn's pre-signed upload URL
    # Must NOT include LinkedIn-Version or X-Restli-Protocol-Version headers here.
    put_resp = httpx.put(
        upload_url,
        content=image_bytes,
        headers={"Content-Type": content_type},
        timeout=120,
    )
    if put_resp.status_code not in (200, 201):
        raise RuntimeError(f"LinkedIn image upload PUT {put_resp.status_code}: {put_resp.text[:400]}")

    return image_urn


# ── Video upload ─────────────────────────────────────────────────────────────

def upload_video_to_linkedin(
    access_token: str,
    author_urn: str,
    video_url: str,
    version: str,
) -> str:
    """Download video from our S3/R2 storage and upload to LinkedIn.

    Returns the LinkedIn video URN (e.g. urn:li:video:...) which is then
    referenced in the post body's content.media block.

    LinkedIn video upload flow (4 steps):
      1. POST /rest/videos?action=initializeUpload  → uploadInstructions + video URN
      2. PUT video bytes to each upload URL (chunked if >4MB)
      3. POST /rest/videos?action=finalizeUpload    → confirms upload complete
      4. Post using the video URN

    Chunk size: LinkedIn requires chunks ≤ 4MB. We split automatically.
    """
    import logging
    logger = logging.getLogger("nivaad.linkedin")

    from app.services.storage import fetch_bytes as _fetch_bytes

    # Step 1 — fetch video bytes from internal S3 storage
    try:
        video_bytes, content_type = _fetch_bytes(video_url)
    except Exception as exc:
        raise RuntimeError(f"Could not read video from storage: {exc}") from exc

    file_size = len(video_bytes)
    logger.info("[linkedin] video size=%d bytes content_type=%s", file_size, content_type)

    hdrs = _headers(access_token, version)

    # Step 2 — initialize upload
    init_resp = httpx.post(
        f"{_get_videos_url()}?action=initializeUpload",
        headers=hdrs,
        json={
            "initializeUploadRequest": {
                "owner": author_urn,
                "fileSizeBytes": file_size,
                "uploadCaptions": False,
                "uploadThumbnail": False,
            }
        },
        timeout=30,
    )
    if init_resp.status_code >= 400:
        raise RuntimeError(f"LinkedIn video initializeUpload {init_resp.status_code}: {init_resp.text[:600]}")

    logger.info("[linkedin] video initializeUpload response: %s", init_resp.text[:400])
    init_data = init_resp.json().get("value", {})
    video_urn = init_data.get("video")
    upload_instructions = init_data.get("uploadInstructions", [])

    if not video_urn or not upload_instructions:
        raise RuntimeError(f"LinkedIn video initializeUpload returned unexpected shape: {init_resp.text[:400]}")

    logger.info("[linkedin] video URN=%s chunks=%d", video_urn, len(upload_instructions))

    # Step 3 — PUT each chunk to its upload URL
    etags = []
    for instruction in upload_instructions:
        upload_url = instruction.get("uploadUrl")
        first_byte = instruction.get("firstByte", 0)
        last_byte = instruction.get("lastByte", file_size - 1)
        chunk = video_bytes[first_byte: last_byte + 1]

        put_resp = httpx.put(
            upload_url,
            content=chunk,
            headers={"Content-Type": "application/octet-stream"},
            timeout=300,  # large chunks can take time
        )
        if put_resp.status_code not in (200, 201):
            raise RuntimeError(f"LinkedIn video chunk PUT {put_resp.status_code}: {put_resp.text[:400]}")

        etag = put_resp.headers.get("ETag") or put_resp.headers.get("etag") or ""
        etags.append({"firstByte": first_byte, "lastByte": last_byte, "uploadedPartId": etag})
        logger.info("[linkedin] chunk bytes=%d-%d uploaded etag=%s", first_byte, last_byte, etag)

    # Step 4 — finalize upload
    finalize_resp = httpx.post(
        f"{_get_videos_url()}?action=finalizeUpload",
        headers=hdrs,
        json={
            "finalizeUploadRequest": {
                "video": video_urn,
                "uploadToken": "",
                "uploadedPartIds": [e["uploadedPartId"] for e in etags],
            }
        },
        timeout=60,
    )
    logger.info("[linkedin] video finalizeUpload response status=%d body=%s", finalize_resp.status_code, finalize_resp.text[:400])
    if finalize_resp.status_code >= 400:
        raise RuntimeError(f"LinkedIn video finalizeUpload {finalize_resp.status_code}: {finalize_resp.text[:600]}")

    logger.info("[linkedin] video upload finalized → %s", video_urn)
    return video_urn


# ── Post ──────────────────────────────────────────────────────────────────────

def post_to_linkedin(
    access_token: str,
    author_urn: str,
    text: str,
    db=None,
    api_version: str | None = None,
    image_url: str | None = None,
    video_url: str | None = None,
) -> str:
    """Post text (+ optional image or video) to LinkedIn. Returns the new post URN.

    Media priority: video_url > image_url > text-only.
    Upload failures fall back to text-only (logs a warning).

    Pass api_version explicitly (preferred when called from async context)
    or db (sync Session only) to override LINKEDIN_API_VERSION default.
    """
    import logging
    logger = logging.getLogger("nivaad.linkedin")

    version = (api_version or "").strip() or _get_api_version(db)
    hdrs = _headers(access_token, version)

    media_urn: str | None = None
    media_type: str | None = None  # "image" or "video"

    # ── Video upload (takes priority over image) ──────────────────────
    if video_url:
        # Let video upload exceptions propagate — this surfaces the real
        # error in the task log and marks the post as failed rather than
        # silently falling back to text-only and reporting success.
        media_urn = upload_video_to_linkedin(access_token, author_urn, video_url, version)
        media_type = "video"
        logger.info("[linkedin] video uploaded → %s", media_urn)

    # ── Image upload (only if no video) ──────────────────────────────
    elif image_url:
        try:
            media_urn = upload_image_to_linkedin(access_token, author_urn, image_url, version)
            media_type = "image"
            logger.info("[linkedin] image uploaded → %s", media_urn)
        except Exception as exc:
            logger.warning("[linkedin] image upload failed, posting text-only: %s", exc)

    # ── Build post body ───────────────────────────────────────────────
    body: dict = {
        "author": author_urn,
        "commentary": text,
        "visibility": "PUBLIC",
        "distribution": {
            "feedDistribution": "MAIN_FEED",
            "targetEntities": [],
            "thirdPartyDistributionChannels": [],
        },
        "lifecycleState": "PUBLISHED",
        "isReshareDisabledByAuthor": False,
    }

    if media_urn:
        if media_type == "video":
            # For video URNs LinkedIn infers the media category automatically
            # from the URN — do NOT include altText or any category override,
            # as that triggers "field override not supported for category" (400).
            body["content"] = {
                "media": {
                    "id": media_urn,
                }
            }
        else:
            body["content"] = {
                "media": {
                    "altText": "Ad image",
                    "id": media_urn,
                }
            }

    posts_url = _get_posts_url(db)
    resp = httpx.post(posts_url, headers=hdrs, json=body, timeout=30)
    if resp.status_code >= 400:
        raise RuntimeError(f"LinkedIn post {resp.status_code}: {resp.text[:500]}")

    return resp.headers.get("x-restli-id", "")
