from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.deps import require_role
from app.models import AuditLog, RoleCapability, User
from app.schemas import RoleCapabilitiesIn, RoleCapabilitiesOut
from app.services.capabilities import DEFAULT_CAPABILITIES, get_capabilities

router = APIRouter(prefix="/admin/capabilities", tags=["admin-capabilities"])


@router.get("", response_model=RoleCapabilitiesOut)
async def get_capabilities_endpoint(user: User = Depends(require_role("admin")), db: AsyncSession = Depends(get_db)):
    """Admin-only, like everything else under /admin/* — this used to be
    open to any active user (so a poster/editor could see the full
    permission matrix, not just their own role's), tightened for real
    defense-in-depth alongside the Admin page route guard."""
    caps = await get_capabilities(db, user.company_id)
    return RoleCapabilitiesOut(**caps)


@router.get("/defaults", response_model=RoleCapabilitiesOut)
async def get_default_capabilities(user: User = Depends(require_role("admin"))):
    """The true, original system defaults — not affected by whatever a
    company has customized. Used by the "Restore defaults" button, which
    stages these into the form for review; nothing is persisted until
    the admin actually clicks Save, same as any other edit here."""
    return RoleCapabilitiesOut(**DEFAULT_CAPABILITIES)


@router.put("", response_model=RoleCapabilitiesOut)
async def update_capabilities(
    data: RoleCapabilitiesIn,
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.scalar(select(RoleCapability).where(RoleCapability.company_id == user.company_id))
    config = {"editor": data.editor, "poster": data.poster}
    if row:
        row.config = config
        flag_modified(row, "config")
    else:
        row = RoleCapability(company_id=user.company_id, config=config)
        db.add(row)
    db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="capabilities.updated", detail=config))
    await db.commit()
    return RoleCapabilitiesOut(**await get_capabilities(db, user.company_id))
