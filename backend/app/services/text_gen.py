"""Text/copy generation — routed through OpenRouter, same as image and
video, using their OpenAI-compatible chat completions endpoint. Direct
Anthropic access (the old approach) is retired; every text model,
including Claude models, now goes through the same OpenRouter account
image/video already use — one balance, one place to monitor spend,
consistent with the developer's pricing/markup system.

Kept as a thin, dedicated function (not folded into images.py/videos.py)
since chat completions is a genuinely different API shape from the
image/video generation endpoints — different request format, different
response parsing, no async submit/poll pattern needed.
"""
import json

import httpx

from app.config import settings

CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"


def generate_text(prompt: str, model: str) -> dict:
    """Sends one prompt, expects the model to return JSON (optionally
    wrapped in markdown code fences, which every prompt in this app
    already instructs against but models don't always comply exactly),
    and returns the parsed dict. Matches the exact contract the old
    direct-Anthropic _call_claude() had, so callers didn't need to
    change."""
    resp = httpx.post(
        CHAT_URL,
        headers={
            "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": 2500,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=90,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"OpenRouter text generation {resp.status_code}: {resp.text[:400]}")
    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError(f"OpenRouter returned no choices: {data}")
    text = choices[0].get("message", {}).get("content", "")
    return json.loads(text.replace("```json", "").replace("```", "").strip())
