from datetime import datetime, timedelta, timezone

import jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _create_token(sub: str, token_type: str, expires_delta: timedelta, extra: dict | None = None) -> str:
    payload = {
        "sub": sub,
        "type": token_type,
        "exp": datetime.now(timezone.utc) + expires_delta,
        "iat": datetime.now(timezone.utc),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_access_token(user_id: str, company_id: str, role: str) -> str:
    return _create_token(
        user_id, "access",
        timedelta(minutes=settings.ACCESS_TOKEN_MINUTES),
        {"company_id": company_id, "role": role},
    )


def create_refresh_token(user_id: str) -> str:
    return _create_token(user_id, "refresh", timedelta(days=settings.REFRESH_TOKEN_DAYS))


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])


def create_developer_token(dev_user_id: str | None = None, permissions: dict | None = None) -> str:
    """Fully separate from the user/company access token — different
    "type" claim ("developer_access" vs "access"), no user_id/company_id
    at all. This is deliberate: the developer dependency (deps.py) never
    touches the User/Company tables, so there's no way this token could
    ever be confused with, or grant access via, the normal per-company
    auth path.

    dev_user_id is omitted entirely for the .env owner login (who always
    has every permission implicitly) and set to the DeveloperTeamUser's id
    for a team-member login, whose granted permissions are embedded in the
    token itself (see services/developer_team.py) so require_developer_
    permission can check them without a DB round-trip on every request."""
    extra = {}
    if dev_user_id:
        extra["dev_user_id"] = dev_user_id
        extra["dev_permissions"] = permissions or {}
    return _create_token("developer", "developer_access", timedelta(hours=12), extra or None)
