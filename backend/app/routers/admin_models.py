from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.deps import require_role
from app.models import AuditLog, CompanyModelConfig, User
from app.schemas import ModelConfigOut, ModelTierOut, UpdateModelTierIn
from app.services.credits import get_model_cfg

router = APIRouter(prefix="/admin/models", tags=["admin-models"])


def _strip_model_names(tiers: dict[str, dict]) -> dict[str, dict]:
    """Company admins choose Low/Medium/Best, not a specific AI model —
    which underlying model powers each tier is a platform implementation
    detail (and the developer's to manage as models get updated), not
    something a company needs or should see. Keeps everything else
    (credits, and for video, min_duration/max_duration) — those ARE
    useful for a company to see, e.g. so they know how long a video
    their current tier allows before generating one."""
    return {tier_name: {k: v for k, v in tier.items() if k != "model"} for tier_name, tier in tiers.items()}


@router.get("", response_model=ModelConfigOut)
async def get_model_config(user: User = Depends(require_role("admin")), db: AsyncSession = Depends(get_db)):
    cfg = await get_model_cfg(db, user.company_id)
    return ModelConfigOut(
        image=ModelTierOut(kind="image", active=cfg["image"]["active"], tiers=_strip_model_names(cfg["image"]["tiers"])),
        video=ModelTierOut(kind="video", active=cfg["video"]["active"], tiers=_strip_model_names(cfg["video"]["tiers"])),
    )


@router.put("", response_model=ModelConfigOut)
async def update_model_tier(
    data: UpdateModelTierIn,
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Only WHICH tier is active is customizable — the tier definitions
    themselves (model names, credit costs) are platform-controlled by
    the developer, not editable per company. This keeps pricing
    trustworthy (a company can't set its own generation cost to
    near-zero) while still giving real control over the cost/quality
    tradeoff."""
    row = await db.scalar(select(CompanyModelConfig).where(CompanyModelConfig.company_id == user.company_id))
    if row is None:
        row = CompanyModelConfig(company_id=user.company_id, config={})
        db.add(row)
        await db.flush()

    config = dict(row.config or {})
    config[data.kind] = {"active": data.active}
    row.config = config
    flag_modified(row, "config")

    db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="model_config.updated",
                    detail={"kind": data.kind, "active": data.active}))
    await db.commit()

    cfg = await get_model_cfg(db, user.company_id)
    return ModelConfigOut(
        image=ModelTierOut(kind="image", active=cfg["image"]["active"], tiers=_strip_model_names(cfg["image"]["tiers"])),
        video=ModelTierOut(kind="video", active=cfg["video"]["active"], tiers=_strip_model_names(cfg["video"]["tiers"])),
    )
