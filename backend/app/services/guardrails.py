"""Layered, CONTEXT-AWARE content guardrails.

Layer 1: hardcoded product defaults (locked — cannot be disabled).
Layer 2: guardrail_rules rows — company_id NULL = global, set = per-company custom.

Design: a plain substring match on these terms alone produces real false
positives — a skincare ad saying "this serum works miracles" is not a false
medical claim, "begun" contains "gun", a hunting-gear retailer legitimately
needs to say "firearm". So matching a term is only the FIRST step (a cheap
pre-filter, so clean text never needs an AI call at all). If a term DOES
appear, a second step asks Claude to judge whether the text is ACTUALLY
using it to promote/describe genuinely harmful or policy-violating content,
versus an incidental, metaphorical, or legitimate business usage. Only a
real contextual match gets blocked and flagged.

Fail-safe design: if the classification call itself errors for any reason
(network issue, malformed response, etc.), the request is BLOCKED rather
than silently allowed — a false positive lands in the admin review queue
for a human to clear; a false negative could mean harmful content shipped
unnoticed. Blocking is the conservative, correct default on failure.
"""
import asyncio
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Company, FlaggedContent, GuardrailRule
from app.services import credits as credit_svc
from app.services import text_gen

DEFAULT_BLOCKLIST = [
    "weapon", "gun", "firearm", "drug", "cocaine", "hate",
    "nude", "nsfw", "tobacco", "vape", "casino", "escort",
]


async def get_or_seed_global_rules(db: AsyncSession) -> list[GuardrailRule]:
    """The platform-wide default blocklist terms — company_id IS NULL
    rows in the same guardrail_rules table companies use for their own
    custom terms. Seeds from DEFAULT_BLOCKLIST the first time (if no
    global rows exist yet); once the developer has added/removed
    anything, the DB is authoritative and DEFAULT_BLOCKLIST is never
    consulted again — same seed-then-edit pattern as the model list.
    This is what makes the defaults developer-editable instead of
    hardcoded and locked."""
    rows = (await db.scalars(
        select(GuardrailRule).where(GuardrailRule.company_id.is_(None)).order_by(GuardrailRule.created_at.asc())
    )).all()
    if rows:
        return list(rows)
    seeded = [GuardrailRule(company_id=None, phrase=term) for term in DEFAULT_BLOCKLIST]
    for r in seeded:
        db.add(r)
    await db.commit()
    for r in seeded:
        await db.refresh(r)
    return seeded


async def _classify_harmful(db: AsyncSession, text: str, term: str) -> tuple[bool, str]:
    """Returns (is_harmful, reason). Fails BLOCKED (conservative) on any error."""
    prompt = (
        "You are a content moderation classifier for an ad-generation platform. "
        f'The following text contains the word or phrase "{term}", which is on a list of terms '
        "that COULD indicate harmful, illegal, or policy-violating content (e.g. weapons, drugs, "
        "hate speech, adult content, illegal goods). However, the word alone does not necessarily "
        "mean the content is harmful — it may be part of an unrelated word, a brand/product name, "
        "a common marketing metaphor (e.g. \"miracle results\"), or another legitimate, everyday "
        "business usage.\n\n"
        f'Text to evaluate: "{text[:2000]}"\n'
        f'Flagged term: "{term}"\n\n'
        "Does this text ACTUALLY use this term to promote, facilitate, or describe genuinely "
        "harmful, illegal, or policy-violating content — as opposed to an incidental or legitimate "
        "usage? Respond ONLY with raw JSON, no markdown fences: "
        '{"harmful": true or false, "reason": "one short sentence"}'
    )
    try:
        models = await credit_svc.get_available_models(db)
        text_options = [m for m in models.get("text", []) if m.get("enabled", True)]
        text_model = text_options[0]["model"] if text_options else "google/gemini-2.5-flash"
        # text_gen.generate_text is sync (built for Celery's sync task
        # context) — this call site is async, so it needs to run
        # off-thread rather than block the event loop, same reasoning
        # as the equivalent fix in campaigns.py.
        parsed = await asyncio.to_thread(text_gen.generate_text, prompt, text_model)
        return bool(parsed["harmful"]), str(parsed.get("reason", ""))
    except Exception as exc:  # noqa: BLE001 — fail safe: block, don't silently allow
        return True, f"Moderation check failed ({exc}); blocked conservatively for review."


async def check_text(
    db: AsyncSession, company_id: uuid.UUID, user_id: uuid.UUID | None, text: str
) -> str | None:
    """Returns the matched term if genuinely blocked, else None.
    Records a flag + strike only on a real, context-confirmed hit."""
    lowered = text.lower()
    await get_or_seed_global_rules(db)  # ensures company_id IS NULL rows exist before the query below reads them
    rules = (await db.scalars(
        select(GuardrailRule.phrase).where(
            (GuardrailRule.company_id == company_id) | (GuardrailRule.company_id.is_(None))
        )
    )).all()

    candidate = None
    for term in rules:
        if term.lower() in lowered:
            candidate = term
            break
    if candidate is None:
        return None  # fast path — nothing to check, no AI call needed

    is_harmful, reason = await _classify_harmful(db, text, candidate)
    if not is_harmful:
        return None  # term appeared, but context is legitimate — allow

    db.add(FlaggedContent(
        company_id=company_id, user_id=user_id,
        text=text[:2000], matched_term=f"{candidate} — {reason}"[:200],
    ))
    company = await db.get(Company, company_id)
    if company:
        company.strikes += 1
    return candidate
