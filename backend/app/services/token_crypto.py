"""Encrypts OAuth tokens before they're stored (PlatformConnection.
encrypted_token) — these are real, live credentials that grant posting
access to a company's actual social accounts, so they're never stored
in plain text. Uses FERNET_KEY (already present in Settings, unused
until now) — generate one with:

    python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

and set it in .env. If FERNET_KEY is empty, encryption is a no-op
passthrough (useful for local dev before you've generated a key) but
this should ALWAYS be set in any real deployment.
"""
import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


def _get_fernet() -> Fernet | None:
    if not settings.FERNET_KEY:
        return None
    try:
        return Fernet(settings.FERNET_KEY.encode())
    except (ValueError, TypeError):
        # Not a valid Fernet key (e.g. someone set a plain password
        # instead of a real generated key) — derive a valid one from it
        # via a hash, rather than crash. Still real encryption, just
        # forgiving about what's in .env.
        derived = base64.urlsafe_b64encode(hashlib.sha256(settings.FERNET_KEY.encode()).digest())
        return Fernet(derived)


def encrypt_token(raw: str) -> str:
    f = _get_fernet()
    if f is None:
        return raw
    return f.encrypt(raw.encode()).decode()


def decrypt_token(encrypted: str) -> str:
    f = _get_fernet()
    if f is None:
        return encrypted
    try:
        return f.decrypt(encrypted.encode()).decode()
    except InvalidToken:
        # Most likely FERNET_KEY changed since this token was stored —
        # treat as unreadable rather than crash the caller; they'll see
        # this as "connection broken, please reconnect", which is the
        # honest state.
        raise ValueError("Could not decrypt stored token — it may have been encrypted with a different FERNET_KEY.")
