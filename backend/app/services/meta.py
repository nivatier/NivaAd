"""Meta Graph API — Facebook Pages, Instagram Business, and Threads posting.

One OAuth flow (via Facebook Login for Business) grants a user token that
covers all three platforms. We exchange it for long-lived page access tokens
for each Page the user selects.

Token types:
  - User token (short-lived, 1-2h)      → exchanged immediately for →
  - Long-lived user token (60 days)      → used to get →
  - Page access tokens (never expire while Page is connected)

Posting flows:
  Facebook video  → Resumable Upload API → /PAGE_ID/videos
  Facebook image  → Graph API /PAGE_ID/photos
  Facebook text   → Graph API /PAGE_ID/feed
  Instagram image → /ig-user-id/media (create container) → /ig-user-id/media_publish
  Instagram video → /ig-user-id/media (REELS) → poll status → /ig-user-id/media_publish
  Threads         → /threads-user-id/threads (create container) → /threads-user-id/threads_publish

CLIENT ID/SECRET are developer-managed in the database
(services/platform_config.py) — never in .env.
"""
import logging
import urllib.parse

import httpx

logger = logging.getLogger("nivaad.meta")

GRAPH_URL     = "https://graph.facebook.com/v21.0"
AUTHORIZE_URL = "https://www.facebook.com/v21.0/dialog/oauth"
TOKEN_URL     = f"{GRAPH_URL}/oauth/access_token"
THREADS_URL   = "https://graph.threads.net/v1.0"

DEFAULT_SCOPE = (
    "pages_show_list,pages_read_engagement,pages_manage_posts,"
    "pages_manage_metadata,publish_video,"
    "instagram_basic,instagram_content_publish,"
    "threads_basic,threads_content_publish"
)


# ── OAuth ─────────────────────────────────────────────────────────────────────

def get_authorize_url(client_id: str, redirect_uri: str, scope: str, state: str) -> str:
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope or DEFAULT_SCOPE,
        "response_type": "code",
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"


def exchange_code_for_token(
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> dict:
    """Exchange authorization code → short-lived user access token."""
    resp = httpx.get(
        TOKEN_URL,
        params={
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "code": code,
        },
        timeout=20,
    )
    _raise_for_meta_error(resp, "Meta token exchange")
    return resp.json()


def exchange_for_long_lived_token(
    short_token: str,
    client_id: str,
    client_secret: str,
) -> str:
    """Exchange short-lived user token → 60-day long-lived token."""
    resp = httpx.get(
        TOKEN_URL,
        params={
            "grant_type": "fb_exchange_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "fb_exchange_token": short_token,
        },
        timeout=20,
    )
    _raise_for_meta_error(resp, "Meta long-lived token exchange")
    return resp.json()["access_token"]


def get_user_id(user_token: str) -> str:
    """Validate the token and return the Facebook User ID."""
    resp = httpx.get(
        f"{GRAPH_URL}/me",
        params={"access_token": user_token},
        timeout=15,
    )
    _raise_for_meta_error(resp, "Meta /me")
    return resp.json()["id"]


# ── Page listing ──────────────────────────────────────────────────────────────

def get_managed_pages(user_token: str) -> list[dict]:
    """Return all Facebook Pages the token-holder can manage.
    Each dict: {page_id, name, access_token, category}
    The page access_token never expires — store this, not the user_token.
    """
    resp = httpx.get(
        f"{GRAPH_URL}/me/accounts",
        params={
            "access_token": user_token,
            "fields": "id,name,access_token,category,tasks",
        },
        timeout=20,
    )
    _raise_for_meta_error(resp, "Meta /me/accounts")
    pages = []
    for p in resp.json().get("data", []):
        tasks = p.get("tasks", [])
        if "ADVERTISE" in tasks or "CREATE_CONTENT" in tasks or not tasks:
            pages.append({
                "page_id": p["id"],
                "name": p.get("name", p["id"]),
                "access_token": p["access_token"],
                "category": p.get("category", ""),
            })
    return pages


def get_instagram_account(page_id: str, page_token: str) -> dict | None:
    """Return the Instagram Business Account linked to a Facebook Page, or None."""
    resp = httpx.get(
        f"{GRAPH_URL}/{page_id}",
        params={
            "access_token": page_token,
            "fields": "instagram_business_account",
        },
        timeout=15,
    )
    if resp.status_code >= 400:
        return None
    data = resp.json()
    if "instagram_business_account" not in data:
        return None
    ig_id = data["instagram_business_account"]["id"]
    ig_resp = httpx.get(
        f"{GRAPH_URL}/{ig_id}",
        params={"access_token": page_token, "fields": "id,username,name"},
        timeout=15,
    )
    if ig_resp.status_code >= 400:
        return {"ig_user_id": ig_id, "username": "", "name": ""}
    ig_data = ig_resp.json()
    return {
        "ig_user_id": ig_data.get("id", ig_id),
        "username": ig_data.get("username", ""),
        "name": ig_data.get("name", ""),
    }


def get_threads_profile(user_token: str) -> dict | None:
    """Return the Threads profile linked to this user token, or None."""
    resp = httpx.get(
        f"{THREADS_URL}/me",
        params={"access_token": user_token, "fields": "id,username,name"},
        timeout=15,
    )
    if resp.status_code >= 400:
        return None
    data = resp.json()
    if "error" in data or not data.get("id"):
        return None
    return {
        "threads_user_id": data["id"],
        "username": data.get("username", ""),
        "name": data.get("name", ""),
    }


# ── Facebook posting ──────────────────────────────────────────────────────────

def post_to_facebook(
    page_token: str,
    page_id: str,
    text: str,
    image_url: str | None = None,
    video_url: str | None = None,
) -> str:
    """Post text/image/video to a Facebook Page. Returns the post ID.
    Video takes priority over image, image over text-only.
    """
    if video_url:
        return _post_video_facebook(page_token, page_id, text, video_url)
    if image_url:
        return _post_image_facebook(page_token, page_id, text, image_url)
    return _post_text_facebook(page_token, page_id, text)


def _post_text_facebook(page_token: str, page_id: str, text: str) -> str:
    resp = httpx.post(
        f"{GRAPH_URL}/{page_id}/feed",
        params={"access_token": page_token},
        json={"message": text},
        timeout=30,
    )
    _raise_for_meta_error(resp, "Facebook text post")
    return resp.json().get("id", "")


def _post_image_facebook(
    page_token: str, page_id: str, text: str, image_url: str
) -> str:
    """Post a single image using its public R2 CDN URL directly."""
    resp = httpx.post(
        f"{GRAPH_URL}/{page_id}/photos",
        params={"access_token": page_token},
        json={"url": image_url, "caption": text, "published": True},
        timeout=60,
    )
    _raise_for_meta_error(resp, "Facebook image post")
    return resp.json().get("id", "")


def _post_video_facebook(
    page_token: str, page_id: str, text: str, video_url: str
) -> str:
    """Upload a video using Facebook's Resumable Upload API (10MB chunks)."""
    from app.services.storage import fetch_bytes as _fetch_bytes

    video_bytes, _ = _fetch_bytes(video_url)
    file_size = len(video_bytes)

    # Step 1 — start upload session
    start_resp = httpx.post(
        f"{GRAPH_URL}/{page_id}/videos",
        params={"access_token": page_token},
        json={"upload_phase": "start", "file_size": file_size},
        timeout=30,
    )
    _raise_for_meta_error(start_resp, "Facebook video upload start")
    session_id = start_resp.json().get("upload_session_id")
    if not session_id:
        raise RuntimeError(
            f"Facebook video upload_start returned no session_id: {start_resp.text[:300]}"
        )

    # Step 2 — transfer in 10MB chunks
    CHUNK_SIZE = 10 * 1024 * 1024
    offset = 0
    while offset < file_size:
        chunk = video_bytes[offset: offset + CHUNK_SIZE]
        transfer_resp = httpx.post(
            f"{GRAPH_URL}/{page_id}/videos",
            params={"access_token": page_token},
            data={
                "upload_phase": "transfer",
                "upload_session_id": session_id,
                "start_offset": offset,
            },
            files={"video_file_chunk": ("chunk.mp4", chunk, "video/mp4")},
            timeout=300,
        )
        _raise_for_meta_error(transfer_resp, f"Facebook video chunk @{offset}")
        offset = int(transfer_resp.json().get("start_offset", offset + len(chunk)))
        logger.info("[facebook] video chunk uploaded, next_offset=%d / %d", offset, file_size)

    # Step 3 — finish and publish
    finish_resp = httpx.post(
        f"{GRAPH_URL}/{page_id}/videos",
        params={"access_token": page_token},
        json={
            "upload_phase": "finish",
            "upload_session_id": session_id,
            "description": text,
            "published": True,
        },
        timeout=60,
    )
    _raise_for_meta_error(finish_resp, "Facebook video publish")
    return finish_resp.json().get("id", session_id)


# ── Instagram posting ─────────────────────────────────────────────────────────

def post_to_instagram(
    page_token: str,
    ig_user_id: str,
    caption: str,
    image_url: str | None = None,
    video_url: str | None = None,
) -> str:
    """Post to Instagram Business. Video posts as a Reel."""
    if video_url:
        return _post_video_instagram(page_token, ig_user_id, caption, video_url)
    if image_url:
        return _post_image_instagram(page_token, ig_user_id, caption, image_url)
    raise RuntimeError("Instagram post requires image_url or video_url.")


def _post_image_instagram(
    page_token: str, ig_user_id: str, caption: str, image_url: str
) -> str:
    import time

    # Step 1 — create container
    create_resp = httpx.post(
        f"{GRAPH_URL}/{ig_user_id}/media",
        params={"access_token": page_token},
        json={"image_url": image_url, "caption": caption},
        timeout=60,
    )
    _raise_for_meta_error(create_resp, "Instagram image container")
    creation_id = create_resp.json().get("id")
    if not creation_id:
        raise RuntimeError(
            f"Instagram image container returned no id: {create_resp.text[:300]}"
        )

    # Step 2 — poll until FINISHED (Instagram needs time to fetch and process
    # the image even for static posts — skipping this causes error_subcode 2207027)
    logger.info("[instagram] image container created: %s — polling for FINISHED", creation_id)
    for attempt in range(15):
        status_resp = httpx.get(
            f"{GRAPH_URL}/{creation_id}",
            params={"access_token": page_token, "fields": "status_code,status"},
            timeout=15,
        )
        if status_resp.status_code == 200:
            status_code = status_resp.json().get("status_code", "")
            logger.info("[instagram] image container %s status=%s (attempt %d)", creation_id, status_code, attempt + 1)
            if status_code == "FINISHED":
                break
            if status_code == "ERROR":
                raise RuntimeError(
                    f"Instagram image processing failed: {status_resp.json().get('status')}"
                )
        time.sleep(3)
    else:
        logger.warning(
            "[instagram] image container %s status check timed out after 45s, attempting publish anyway",
            creation_id,
        )

    # Step 3 — publish
    pub_resp = httpx.post(
        f"{GRAPH_URL}/{ig_user_id}/media_publish",
        params={"access_token": page_token},
        json={"creation_id": creation_id},
        timeout=30,
    )
    _raise_for_meta_error(pub_resp, "Instagram image publish")
    return pub_resp.json().get("id", creation_id)


def _post_video_instagram(
    page_token: str, ig_user_id: str, caption: str, video_url: str
) -> str:
    """Instagram Reels — two-step with processing poll (max ~60s wait)."""
    import time

    # Step 1 — create Reel container
    create_resp = httpx.post(
        f"{GRAPH_URL}/{ig_user_id}/media",
        params={"access_token": page_token},
        json={
            "media_type": "REELS",
            "video_url": video_url,
            "caption": caption,
            "share_to_feed": True,
        },
        timeout=60,
    )
    _raise_for_meta_error(create_resp, "Instagram Reel container")
    creation_id = create_resp.json().get("id")
    if not creation_id:
        raise RuntimeError(
            f"Instagram Reel container returned no id: {create_resp.text[:300]}"
        )

    logger.info("[instagram] Reel container created: %s — polling for processing", creation_id)

    # Step 2 — poll until ready
    for _ in range(20):
        status_resp = httpx.get(
            f"{GRAPH_URL}/{creation_id}",
            params={"access_token": page_token, "fields": "status_code,status"},
            timeout=15,
        )
        if status_resp.status_code == 200:
            status_code = status_resp.json().get("status_code", "")
            if status_code == "FINISHED":
                break
            if status_code == "ERROR":
                raise RuntimeError(
                    f"Instagram Reel processing failed: {status_resp.json().get('status')}"
                )
        time.sleep(3)
    else:
        logger.warning(
            "[instagram] Reel container %s status check timed out, attempting publish anyway",
            creation_id,
        )

    # Step 3 — publish
    pub_resp = httpx.post(
        f"{GRAPH_URL}/{ig_user_id}/media_publish",
        params={"access_token": page_token},
        json={"creation_id": creation_id},
        timeout=30,
    )
    _raise_for_meta_error(pub_resp, "Instagram Reel publish")
    return pub_resp.json().get("id", creation_id)


# ── Threads posting ───────────────────────────────────────────────────────────

def post_to_threads(
    user_token: str,
    threads_user_id: str,
    text: str,
    image_url: str | None = None,
    video_url: str | None = None,
) -> str:
    """Post to Threads — two-step: create container → publish."""
    media_type = "TEXT"
    if image_url:
        media_type = "IMAGE"
    elif video_url:
        media_type = "VIDEO"

    container_body: dict = {"text": text, "media_type": media_type}
    if image_url:
        container_body["image_url"] = image_url
    if video_url and media_type == "VIDEO":
        container_body["video_url"] = video_url

    # Step 1 — create container
    create_resp = httpx.post(
        f"{THREADS_URL}/{threads_user_id}/threads",
        params={"access_token": user_token},
        json=container_body,
        timeout=60,
    )
    _raise_for_meta_error(create_resp, "Threads container")
    creation_id = create_resp.json().get("id")
    if not creation_id:
        raise RuntimeError(
            f"Threads container returned no id: {create_resp.text[:300]}"
        )

    # Step 2 — publish
    pub_resp = httpx.post(
        f"{THREADS_URL}/{threads_user_id}/threads_publish",
        params={"access_token": user_token},
        json={"creation_id": creation_id},
        timeout=30,
    )
    _raise_for_meta_error(pub_resp, "Threads publish")
    return pub_resp.json().get("id", creation_id)


# ── Error helper ──────────────────────────────────────────────────────────────

def _raise_for_meta_error(resp: httpx.Response, context: str) -> None:
    if resp.status_code >= 400:
        raise RuntimeError(f"{context} {resp.status_code}: {resp.text[:500]}")
    data = resp.json()
    if "error" in data:
        err = data["error"]
        raise RuntimeError(
            f"{context} error {err.get('code')}: {err.get('message', data)}"
        )


# ── Threads OAuth ─────────────────────────────────────────────────────────────

THREADS_AUTHORIZE_URL = "https://threads.net/oauth/authorize"
THREADS_TOKEN_URL     = "https://graph.threads.net/oauth/access_token"
THREADS_LONGTOKEN_URL = "https://graph.threads.net/access_token"


def get_threads_authorize_url(
    client_id: str, redirect_uri: str, state: str
) -> str:
    """Build the Threads OAuth authorize URL.
    Threads uses its own OAuth endpoint separate from Facebook.
    The Threads App ID is shown as 'Threads app ID' in Meta App Settings -> Basic.
    """
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": "threads_basic,threads_content_publish",
        "response_type": "code",
        "state": state,
    }
    return f"{THREADS_AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"


def exchange_threads_code_for_token(
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> dict:
    """Exchange Threads authorization code -> short-lived token (1 hour)."""
    resp = httpx.post(
        THREADS_TOKEN_URL,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "code": code,
            "grant_type": "authorization_code",
        },
        timeout=20,
    )
    _raise_for_meta_error(resp, "Threads token exchange")
    return resp.json()


def exchange_threads_for_long_lived_token(
    short_token: str,
    client_secret: str,
) -> dict:
    """Exchange short-lived Threads token -> long-lived token (60 days)."""
    resp = httpx.get(
        THREADS_LONGTOKEN_URL,
        params={
            "grant_type": "th_exchange_token",
            "client_secret": client_secret,
            "access_token": short_token,
        },
        timeout=20,
    )
    _raise_for_meta_error(resp, "Threads long-lived token exchange")
    return resp.json()


def get_threads_user_profile(access_token: str) -> dict:
    """Fetch the Threads user profile to validate the token."""
    resp = httpx.get(
        f"{THREADS_URL}/me",
        params={"fields": "id,username,name", "access_token": access_token},
        timeout=15,
    )
    _raise_for_meta_error(resp, "Threads /me")
    return resp.json()
