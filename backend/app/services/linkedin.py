"""LinkedIn OAuth (3-legged, authorization_code grant) and the real
Posts API — verified against LinkedIn's current documented endpoints
and payload shape (not guessed): token exchange at
https://www.linkedin.com/oauth/v2/accessToken, posting at
https://api.linkedin.com/rest/posts with the LinkedIn-Version header
in YYYYMM format and X-Restli-Protocol-Version: 2.0.0.

IMPORTANT SCOPE CAVEAT: LinkedIn draws a hard line between posting to a
PERSONAL profile (w_member_social — self-serve, no approval needed)
and posting to a COMPANY PAGE (w_organization_social — requires
LinkedIn's Community Management API approval, which is a real, multi-
day-or-longer application process). The scope requested is whatever
the developer configured in Developer > Platforms; the author URN
construction below assumes personal-profile posting
(urn:li:person:{id}) to match the default scope — switch both together
once organization access is approved.

CLIENT ID/SECRET ARE NO LONGER READ FROM .env — they're developer-
managed in the database (see services/platform_config.py) so they can
be added/rotated without a server restart, and every function here
takes them as explicit parameters instead."""
import urllib.parse

import httpx

AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization"
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
USERINFO_URL = "https://api.linkedin.com/v2/userinfo"  # OpenID Connect — gives us the person's own URN
POSTS_URL = "https://api.linkedin.com/rest/posts"
LINKEDIN_API_VERSION = "202506"  # YYYYMM per LinkedIn's Linkedin-Version header requirement — bump periodically
DEFAULT_SCOPE = "openid profile w_member_social"


def get_authorize_url(client_id: str, redirect_uri: str, scope: str, state: str) -> str:
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "scope": scope or DEFAULT_SCOPE,
    }
    return f"{AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"


def exchange_code_for_token(code: str, client_id: str, client_secret: str, redirect_uri: str) -> dict:
    """Returns {access_token, expires_in, refresh_token?} — LinkedIn
    tokens are documented to last 60 days, refresh tokens 365 days."""
    resp = httpx.post(
        TOKEN_URL,
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


def get_person_urn(access_token: str) -> str:
    """OpenID Connect userinfo — the 'sub' claim is the member's ID,
    used to build the author URN for personal-profile posts."""
    resp = httpx.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}, timeout=20)
    if resp.status_code >= 400:
        raise RuntimeError(f"LinkedIn userinfo {resp.status_code}: {resp.text[:400]}")
    sub = resp.json().get("sub")
    if not sub:
        raise RuntimeError(f"LinkedIn userinfo response had no 'sub' claim: {resp.text[:400]}")
    return f"urn:li:person:{sub}"


def post_to_linkedin(access_token: str, author_urn: str, text: str) -> str:
    """Text-only post for now — LinkedIn's image/video upload flow is a
    separate multi-step process (register upload -> PUT the binary ->
    reference the resulting asset URN in the post), not yet wired in
    here. Returns the new post's URN."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": LINKEDIN_API_VERSION,
    }
    body = {
        "author": author_urn,
        "commentary": text,
        "visibility": "PUBLIC",
        "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": []},
        "lifecycleState": "PUBLISHED",
        "isReshareDisabledByAuthor": False,
    }
    resp = httpx.post(POSTS_URL, headers=headers, json=body, timeout=30)
    if resp.status_code >= 400:
        raise RuntimeError(f"LinkedIn post {resp.status_code}: {resp.text[:500]}")
    # LinkedIn returns the new post's URN in the x-restli-id response header, not the body.
    return resp.headers.get("x-restli-id", "")
