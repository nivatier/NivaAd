import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_role
from app.models import Company, FlaggedContent, GuardrailRule, User
from app.schemas import (
    FlaggedContentOut, GuardrailRuleCreateIn, GuardrailRuleOut, ModerationOverviewOut,
)
from app.services.guardrails import DEFAULT_BLOCKLIST

router = APIRouter(prefix="/moderation", tags=["moderation"])


@router.get("/overview", response_model=ModerationOverviewOut)
async def overview(user: User = Depends(require_role("admin")), db: AsyncSession = Depends(get_db)):
    company = await db.get(Company, user.company_id)
    return ModerationOverviewOut(default_rules=DEFAULT_BLOCKLIST, strikes=company.strikes if company else 0)


@router.get("/rules", response_model=list[GuardrailRuleOut])
async def list_rules(user: User = Depends(require_role("admin")), db: AsyncSession = Depends(get_db)):
    """Only this company's OWN custom rules — the locked global defaults
    are returned separately via /moderation/overview and can't be edited
    here (that protection is deliberate, not a missing feature)."""
    rows = (await db.scalars(
        select(GuardrailRule).where(GuardrailRule.company_id == user.company_id)
        .order_by(GuardrailRule.created_at.desc())
    )).all()
    return rows


@router.post("/rules", response_model=GuardrailRuleOut, status_code=201)
async def add_rule(
    data: GuardrailRuleCreateIn,
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    phrase = data.phrase.strip().lower()
    if not phrase:
        raise HTTPException(422, "Rule text cannot be empty")
    existing = await db.scalar(
        select(GuardrailRule).where(GuardrailRule.company_id == user.company_id, GuardrailRule.phrase == phrase)
    )
    if existing:
        raise HTTPException(409, "This rule already exists")
    rule = GuardrailRule(company_id=user.company_id, phrase=phrase)
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: uuid.UUID,
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    rule = await db.get(GuardrailRule, rule_id)
    if rule is None or rule.company_id != user.company_id:
        # company_id IS NULL for global defaults — this also correctly blocks
        # attempts to delete them via this endpoint, since None != user.company_id.
        raise HTTPException(404, "Rule not found")
    await db.delete(rule)
    await db.commit()


@router.get("/flagged", response_model=list[FlaggedContentOut])
async def list_flagged(user: User = Depends(require_role("admin")), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(
        select(FlaggedContent).where(FlaggedContent.company_id == user.company_id)
        .order_by(FlaggedContent.created_at.desc()).limit(100)
    )).all()
    return rows


@router.post("/flagged/{flag_id}/resolve", response_model=FlaggedContentOut)
async def resolve_flag(
    flag_id: uuid.UUID,
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    flag = await db.get(FlaggedContent, flag_id)
    if flag is None or flag.company_id != user.company_id:
        raise HTTPException(404, "Flagged item not found")
    flag.resolved = True
    await db.commit()
    await db.refresh(flag)
    return flag
