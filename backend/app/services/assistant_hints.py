"""Developer-managed explanation messages for the in-app assistant mascot
(the little robot in Create Ad / the nav sidebar). Each entry has a
stable `key` that the frontend tags onto a UI element via
`data-robot-hint-key="<key>"` — clicking that element looks the message
up here and has the mascot walk over and explain it. Stored in the same
ModelConfig(id=1) JSON blob pattern as themes.py and pricing.py, under
its own top-level "assistant_hints" key — no migration needed.

TTS audio is generated via OpenRouter's chat completions endpoint using
openai/gpt-audio-mini (the same /v1/chat/completions route
OpenRouter already proxies, just with modalities: ["audio"]). The
response carries the MP3 as base64 in choices[0].message.audio.data,
which we decode and upload to MinIO — no extra API key needed.
"""
import asyncio
import base64

import httpx
from sqlalchemy.orm.attributes import flag_modified

from app.config import settings
from app.models import ModelConfig
from app.services.storage import upload_bytes

DEFAULT_ASSISTANT_SETTINGS = {
    "assistant_name": "Nova",       # mascot's display name — used in its own intro speech and the developer panel; fully developer-editable
    "typing_ms_per_char": 22,      # ms per character — higher = slower typing
    "tts_voice": "nova",            # OpenAI audio voice: alloy, echo, fable, onyx, nova, shimmer
    "tts_model": "openai/gpt-audio-mini",  # OpenRouter model slug
}

# NOTE: There are intentionally no hardcoded default hints here. All hint
# messages live exclusively in ModelConfig(id=1).config["assistant_hints"],
# managed entirely from Developer > Assistant. If that list is empty, no
# hints exist yet and the mascot simply won't have anything to say for any
# UI element until the developer adds some from the panel.
#
# `scripts/seed_assistant_hints.py` contains a one-time, run-it-yourself seed
# of the original starter set (nav items, Create Ad fields, etc.) for anyone
# bootstrapping a fresh environment — it is NOT imported or run automatically
# from application code.


DEPRECATED_MODEL_SLUGS = {
    "openai/gpt-4o-mini-audio-preview": "openai/gpt-audio-mini",
    "openai/gpt-4o-audio-preview": "openai/gpt-audio-mini",
    # Any other variants that may end up stored
    "openai/gpt-audio-mini-audio-preview": "openai/gpt-audio-mini",
}

async def get_assistant_settings(db) -> dict:
    row = await db.get(ModelConfig, 1)
    stored = (row.config if row and row.config else {}).get("assistant_settings") or {}
    merged = {**DEFAULT_ASSISTANT_SETTINGS, **stored}
    # Auto-correct stale model slugs saved before the correct ID was known —
    # avoids requiring a manual DB edit every time the slug changes.
    if merged.get("tts_model") in DEPRECATED_MODEL_SLUGS:
        merged["tts_model"] = DEPRECATED_MODEL_SLUGS[merged["tts_model"]]
    return merged


async def set_assistant_settings(db, typing_ms_per_char: int, tts_voice: str = "nova", tts_model: str = "openai/gpt-audio-mini", assistant_name: str = "Nova") -> dict:
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    existing = dict(config.get("assistant_settings") or {})
    existing.update({
        "typing_ms_per_char": typing_ms_per_char,
        "tts_voice": tts_voice,
        "tts_model": tts_model,
        "assistant_name": (assistant_name or "Nova").strip() or "Nova",
    })
    config["assistant_settings"] = existing
    row.config = config
    flag_modified(row, "config")
    await db.commit()
    return await get_assistant_settings(db)


async def get_assistant_hints(db) -> list[dict]:
    """Returns exactly what's stored under assistant_hints in the DB — no
    code-side defaults are merged in. An empty/missing list simply means the
    developer hasn't added any hints yet from Developer > Assistant."""
    row = await db.get(ModelConfig, 1)
    stored = (row.config if row and row.config else {}).get("assistant_hints")
    hints = stored if stored is not None else []
    # Backfill audio_url for hints saved before this field existed.
    for h in hints:
        h.setdefault("audio_url", None)
    return hints


async def set_assistant_hints(db, hints: list[dict]) -> list[dict]:
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    config["assistant_hints"] = hints
    row.config = config
    flag_modified(row, "config")
    await db.commit()
    return await get_assistant_hints(db)


async def add_assistant_hint(db, key: str, label: str, message: str) -> list[dict]:
    hints = await get_assistant_hints(db)
    if any(h["key"] == key for h in hints):
        raise ValueError(f'A hint with key "{key}" already exists.')
    new_id = f"hint-{abs(hash(key)) % 100000}"
    hints.append({"id": new_id, "key": key, "label": label, "message": message, "audio_url": None})
    return await set_assistant_hints(db, hints)


async def update_assistant_hint(db, hint_id: str, label: str, message: str) -> list[dict]:
    """Only label/message are editable — key is immutable (it's wired to a
    real DOM element). Updating the message also clears any existing audio_url
    so the developer knows to regenerate audio for the new text."""
    hints = await get_assistant_hints(db)
    for h in hints:
        if h["id"] == hint_id:
            text_changed = h["message"] != message
            h["label"] = label
            h["message"] = message
            if text_changed:
                h["audio_url"] = None  # stale — text changed, regenerate audio
            break
    else:
        raise ValueError(f'No assistant hint with id "{hint_id}".')
    return await set_assistant_hints(db, hints)


async def delete_assistant_hint(db, hint_id: str) -> list[dict]:
    hints = [h for h in await get_assistant_hints(db) if h["id"] != hint_id]
    return await set_assistant_hints(db, hints)

async def _generate_audio_via_openrouter(text: str, voice: str, model: str) -> bytes:
    """Generates speech audio via OpenRouter using openai/gpt-audio-mini.

    OpenAI's audio output API has two modes:
    - Non-streaming (stream=False): supports mp3/opus/aac/flac/wav/pcm formats.
    - Streaming (stream=True): ONLY supports pcm16 format.

    We try non-streaming + mp3 first (best quality, single blob).
    If OpenRouter says streaming is required, we fall back to streaming + pcm16
    and wrap the raw PCM bytes in a WAV container using stdlib `wave` (no ffmpeg
    dependency) — WAV plays fine in all browsers and MinIO serves it without issue.
    """
    import wave, io as _io

    payload_base = {
        "model": model,
        "modalities": ["text", "audio"],
        "messages": [
            {"role": "user", "content": f"Please say the following text exactly as written, with a warm and friendly tone:\n\n{text}"}
        ],
    }
    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }

    def _non_streaming() -> bytes | None:
        resp = httpx.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json={**payload_base, "stream": False, "audio": {"voice": voice, "format": "mp3"}},
            timeout=120,
        )
        if resp.status_code == 400:
            msg = ""
            try:
                msg = resp.json().get("error", {}).get("message", "")
            except Exception:
                msg = resp.text
            if "stream" in msg.lower():
                return None  # streaming required — caller will retry
            raise RuntimeError(f"OpenRouter audio API returned 400: {resp.text[:400]}")
        if resp.status_code != 200:
            raise RuntimeError(f"OpenRouter audio API returned {resp.status_code}: {resp.text[:400]}")
        body = resp.json()
        try:
            return base64.b64decode(body["choices"][0]["message"]["audio"]["data"])
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(f"Unexpected non-streaming audio response: {body}") from exc

    def _streaming_pcm16_to_wav() -> bytes:
        """Streams pcm16 (the only format OpenAI allows when stream=True),
        collects the base64 chunks, decodes them, and wraps in a WAV
        container so the browser can play it directly."""
        import json as _json
        accumulated_b64 = ""
        with httpx.stream(
            "POST",
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json={**payload_base, "stream": True, "audio": {"voice": voice, "format": "pcm16"}},
            timeout=120,
        ) as resp:
            if resp.status_code != 200:
                body = resp.read()
                raise RuntimeError(f"OpenRouter audio stream returned {resp.status_code}: {body[:400].decode(errors='replace')}")
            for line in resp.iter_lines():
                if not line or not line.startswith("data:"):
                    continue
                chunk_str = line[5:].strip()
                if chunk_str == "[DONE]":
                    break
                try:
                    chunk = _json.loads(chunk_str)
                    accumulated_b64 += chunk["choices"][0]["delta"]["audio"]["data"]
                except (KeyError, IndexError, TypeError, ValueError):
                    pass

        if not accumulated_b64:
            raise RuntimeError("Stream completed but no audio data received.")

        raw_pcm = base64.b64decode(accumulated_b64)
        # Wrap raw PCM16 (16-bit little-endian, 24 kHz mono — OpenAI's fixed output
        # spec for pcm16) in a RIFF/WAV container using stdlib `wave`.
        buf = _io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)    # mono
            wf.setsampwidth(2)    # 16-bit = 2 bytes
            wf.setframerate(24000)  # 24 kHz
            wf.writeframes(raw_pcm)
        return buf.getvalue()

    result = await asyncio.to_thread(_non_streaming)
    if result is None:
        result = await asyncio.to_thread(_streaming_pcm16_to_wav)
    return result


async def generate_hint_audio(db, hint_id: str) -> list[dict]:
    hints = await get_assistant_hints(db)
    hint = next((h for h in hints if h["id"] == hint_id), None)
    if not hint:
        raise ValueError(f'No assistant hint with id "{hint_id}".')
    s = await get_assistant_settings(db)
    # Persist the corrected model slug back to DB if it was stale
    if s["tts_model"] in DEPRECATED_MODEL_SLUGS:
        s["tts_model"] = DEPRECATED_MODEL_SLUGS[s["tts_model"]]
        await set_assistant_settings(db, s["typing_ms_per_char"], s["tts_voice"], s["tts_model"], s.get("assistant_name", "Nova"))
    mp3 = await _generate_audio_via_openrouter(hint["message"], s["tts_voice"], s["tts_model"])
    url = await asyncio.to_thread(upload_bytes, mp3, "audio/wav", "wav", "nova-audio")
    hint["audio_url"] = url
    return await set_assistant_hints(db, hints)


async def generate_intro_audio(db, text: str) -> str:
    s = await get_assistant_settings(db)
    if s["tts_model"] in DEPRECATED_MODEL_SLUGS:
        s["tts_model"] = DEPRECATED_MODEL_SLUGS[s["tts_model"]]
        await set_assistant_settings(db, s["typing_ms_per_char"], s["tts_voice"], s["tts_model"], s.get("assistant_name", "Nova"))
    wav = await _generate_audio_via_openrouter(text, s["tts_voice"], s["tts_model"])
    url = await asyncio.to_thread(upload_bytes, wav, "audio/wav", "wav", "nova-audio")
    row = await db.get(ModelConfig, 1)
    if row is None:
        row = ModelConfig(id=1, config={})
        db.add(row)
        await db.flush()
    config = dict(row.config or {})
    blob = dict(config.get("assistant_settings") or {})
    blob["intro_audio_url"] = url
    # The text is stored alongside the audio so the frontend types out exactly
    # what was spoken — previously the mascot's on-screen intro text was a
    # separate hardcoded string in robot-mascot.tsx and never matched what was
    # typed into the developer panel, so a new voice/text pair silently fell
    # out of sync with what actually displayed to users.
    blob["intro_text"] = text
    config["assistant_settings"] = blob
    row.config = config
    flag_modified(row, "config")
    await db.commit()
    return url
