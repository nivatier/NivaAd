"""MinIO (S3-compatible) storage for generated and uploaded media.
In production this same code targets Cloudflare R2 — only the
S3_ENDPOINT_URL / keys change; boto3 usage is identical.
"""
import base64
import uuid

import boto3
from botocore.client import Config as BotoConfig

from app.config import settings

_client = None


def s3():
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            config=BotoConfig(signature_version="s3v4"),
            region_name="us-east-1",
        )
    return _client


def upload_bytes(data: bytes, content_type: str, ext: str, prefix: str = "generated") -> str:
    """Uploads and returns a URL the browser (and OpenRouter) can load directly."""
    key = f"{prefix}/{uuid.uuid4()}.{ext}"
    s3().put_object(Bucket=settings.S3_BUCKET, Key=key, Body=data, ContentType=content_type)
    return f"{settings.S3_PUBLIC_URL}/{settings.S3_BUCKET}/{key}"


def upload_data_url(data_url: str, prefix: str = "uploads") -> str:
    """Decodes a browser-side base64 data URL and uploads it, returning a public URL."""
    header, b64data = data_url.split(",", 1)
    content_type = header.split(":")[1].split(";")[0]
    ext = content_type.split("/")[-1]
    return upload_bytes(base64.b64decode(b64data), content_type, ext, prefix=prefix)


def _key_from_url(url: str) -> str:
    """Recovers the S3 object key from a URL we generated ourselves
    (format: {S3_PUBLIC_URL}/{S3_BUCKET}/{key})."""
    marker = f"/{settings.S3_BUCKET}/"
    if marker not in url:
        raise ValueError(f"URL does not look like one of our own storage URLs: {url}")
    return url.split(marker, 1)[1]


def delete_object(url: str) -> None:
    """Removes one object from storage — used by the retention cleanup
    job. Silently no-ops on a URL that isn't one of ours or is already
    gone, rather than raising, since cleanup should keep going even if
    one file is already missing (e.g. a previous run partially
    completed)."""
    try:
        key = _key_from_url(url)
    except ValueError:
        return
    try:
        s3().delete_object(Bucket=settings.S3_BUCKET, Key=key)
    except Exception:  # noqa: BLE001
        pass  # already gone, or a transient error — the caller logs the overall batch result, not per-file


def fetch_bytes(url: str) -> tuple[bytes, str]:
    """Reads an object back out of MinIO (via the internal S3_ENDPOINT_URL,
    always reachable container-to-container) and returns (raw_bytes,
    content_type). Used both for handing images to external APIs inline
    (as base64) and for local image processing (e.g. logo compositing)."""
    key = _key_from_url(url)
    obj = s3().get_object(Bucket=settings.S3_BUCKET, Key=key)
    return obj["Body"].read(), obj.get("ContentType", "image/png")


def fetch_as_data_url(url: str) -> str:
    """Same as fetch_bytes, but returns an inline base64 data URL — for
    external APIs (like OpenRouter) that can't reach our local storage
    directly by URL in development."""
    data, content_type = fetch_bytes(url)
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:{content_type};base64,{b64}"
