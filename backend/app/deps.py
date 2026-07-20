import uuid

import jwt as pyjwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.security import decode_token

bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = decode_token(creds.credentials)
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    user = await db.get(User, uuid.UUID(payload["sub"]))
    if user is None or user.status != "active":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    return user


def require_role(*roles: str):
    async def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return user
    return checker


def require_capability(capability: str):
    """Admin always passes. Editor/Poster are checked against the
    company's configured capabilities (Admin > Profiles) — defaults to
    the built-in sensible defaults if never customized."""
    async def checker(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
        if user.role == "admin":
            return user
        from app.services.capabilities import user_has_capability  # local import avoids a circular import at module load time
        if not await user_has_capability(db, user, capability):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Your role ({user.role}) doesn't have this permission — ask an admin to grant it in Admin > Profiles.",
            )
        return user
    return checker


async def require_developer(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> str:
    """Completely separate from get_current_user — never queries the
    User or Company tables at all. A developer session has no row in
    the database whatsoever; it's validated purely against the JWT's
    "type" claim, which only create_developer_token() can produce (and
    that's only ever called after checking the .env credentials, or —
    for a team member — a valid row in developer_team_users). This is
    the BASE developer auth check only: any logged-in developer, owner
    or team member regardless of granted permissions, passes here. Use
    require_developer_permission(section) instead where a specific
    section's access should actually be restricted."""
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = decode_token(creds.credentials)
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    if payload.get("type") != "developer_access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not a developer session")
    return "developer"


def require_developer_permission(section: str):
    """Gates one Developer > ... section. The .env owner login (no
    dev_user_id claim in the token) always passes. A team-member token
    carries its granted permissions right in the JWT (set at login from
    developer_team_users.permissions), so this never needs a DB
    round-trip. Used on top of require_developer for the specific
    sections team members should be restricted from — see
    services/developer_team.py for the full permission list."""
    async def checker(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> str:
        if creds is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
        try:
            payload = decode_token(creds.credentials)
        except pyjwt.ExpiredSignatureError:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
        except pyjwt.InvalidTokenError:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
        if payload.get("type") != "developer_access":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not a developer session")
        if not payload.get("dev_user_id"):
            return "developer"  # the .env owner — always allowed
        if not (payload.get("dev_permissions") or {}).get(section):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f'Your developer account doesn\'t have access to "{section}" — ask the owner to grant it in Developer > Team.',
            )
        return "developer"
    return checker
