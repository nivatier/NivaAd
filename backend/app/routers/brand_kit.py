from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_capability
from app.models import BrandKit, User
from app.schemas import BrandKitOut, BrandKitUpdateIn
from app.services.storage import upload_data_url

router = APIRouter(prefix="/brand-kit", tags=["brand-kit"])

VALID_PLACEMENTS = {"top-left", "top-right", "bottom-left", "bottom-right"}
VALID_PAD_MODES = {"blurred_video", "image", "color"}


async def _get_or_create(db: AsyncSession, company_id) -> BrandKit:
    kit = await db.scalar(select(BrandKit).where(BrandKit.company_id == company_id))
    if kit is None:
        # Registration is supposed to create this row (see routers/auth.py), but
        # guard against older accounts or any gap so this endpoint never 404s.
        kit = BrandKit(company_id=company_id)
        db.add(kit)
        await db.commit()
        await db.refresh(kit)
    return kit


@router.get("", response_model=BrandKitOut)
async def get_brand_kit(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _get_or_create(db, user.company_id)


@router.put("", response_model=BrandKitOut)
async def update_brand_kit(data: BrandKitUpdateIn, user: User = Depends(require_capability("manage_brand_kit")), db: AsyncSession = Depends(get_db)):
    kit = await _get_or_create(db, user.company_id)
    if data.logo is not None:
        if data.logo == "":
            kit.logo_url = None  # explicit removal
        else:
            kit.logo_url = upload_data_url(data.logo, prefix="brand")
    if data.primary_color is not None:
        kit.primary_color = data.primary_color
    if data.tagline is not None:
        kit.tagline = data.tagline
    if data.logo_placement is not None and data.logo_placement in VALID_PLACEMENTS:
        kit.logo_placement = data.logo_placement
    if data.vertical_pad_mode is not None and data.vertical_pad_mode in VALID_PAD_MODES:
        kit.vertical_pad_mode = data.vertical_pad_mode
    if data.horizontal_pad_mode is not None and data.horizontal_pad_mode in VALID_PAD_MODES:
        kit.horizontal_pad_mode = data.horizontal_pad_mode
    for field, image_attr in [
        ("pad_top_image", "pad_top_image_url"), ("pad_bottom_image", "pad_bottom_image_url"),
        ("pad_left_image", "pad_left_image_url"), ("pad_right_image", "pad_right_image_url"),
    ]:
        value = getattr(data, field)
        if value is not None:
            setattr(kit, image_attr, None if value == "" else upload_data_url(value, prefix="brand"))
    if data.vertical_pad_color is not None:
        kit.vertical_pad_color = data.vertical_pad_color or None
    if data.horizontal_pad_color is not None:
        kit.horizontal_pad_color = data.horizontal_pad_color or None
    await db.commit()
    await db.refresh(kit)
    return kit
