from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_capability
from app.models import BrandKit, BrandLogo, BrandVideoShot, CreditLedger, User
from app.schemas import (
    AddBrandLogoIn, BrandKitOut, BrandKitUpdateIn, BrandLogoOut, BrandVideoShotOut,
    GenerateBrandVideoShotIn, PlatformRatioOverrideIn, UpdateBrandVideoShotIn,
)
from app.services import credits as credit_svc
from app.services import video_ratios as video_ratios_svc
from app.services.storage import upload_data_url
from app.worker import celery_app

router = APIRouter(prefix="/brand-kit", tags=["brand-kit"])

VALID_PLACEMENTS = {"top-left", "top-right", "bottom-left", "bottom-right"}
VALID_PAD_MODES = {"blurred_video", "image", "color"}
MAX_LOGOS = 5
MAX_SHOTS_PER_KIND = 3


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


async def _logo_out(db: AsyncSession, company_id, active_url: str | None) -> list[BrandLogoOut]:
    rows = (await db.scalars(select(BrandLogo).where(BrandLogo.company_id == company_id).order_by(BrandLogo.created_at.asc()))).all()
    return [BrandLogoOut(id=str(r.id), url=r.url, is_active=(r.url == active_url), created_at=r.created_at) for r in rows]


@router.get("/logos", response_model=list[BrandLogoOut])
async def list_brand_logos(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """The full logo gallery (up to 5) — the one flagged is_active is
    whichever's url currently matches BrandKit.logo_url, the single
    field every ad-generation consumer actually reads."""
    kit = await _get_or_create(db, user.company_id)
    return await _logo_out(db, user.company_id, kit.logo_url)


@router.post("/logos", response_model=list[BrandLogoOut])
async def add_brand_logo(data: AddBrandLogoIn, user: User = Depends(require_capability("manage_brand_kit")), db: AsyncSession = Depends(get_db)):
    kit = await _get_or_create(db, user.company_id)
    existing = (await db.scalars(select(BrandLogo).where(BrandLogo.company_id == user.company_id))).all()
    if len(existing) >= MAX_LOGOS:
        raise HTTPException(422, f"You can keep up to {MAX_LOGOS} logos — delete one before adding another.")
    url = upload_data_url(data.logo, prefix="brand")
    logo = BrandLogo(company_id=user.company_id, url=url)
    db.add(logo)
    # First logo ever uploaded becomes the active one automatically — every
    # subsequent upload just adds to the gallery, activation is explicit.
    if kit.logo_url is None:
        kit.logo_url = url
    await db.commit()
    return await _logo_out(db, user.company_id, kit.logo_url)


@router.put("/logos/{logo_id}/activate", response_model=list[BrandLogoOut])
async def activate_brand_logo(logo_id: str, user: User = Depends(require_capability("manage_brand_kit")), db: AsyncSession = Depends(get_db)):
    """Sets this gallery entry as the one actually used in ad
    generation — just copies its url onto BrandKit.logo_url, the same
    field that's always been read there, so nothing downstream needs
    to know the gallery exists at all."""
    kit = await _get_or_create(db, user.company_id)
    logo = await db.get(BrandLogo, logo_id)
    if logo is None or logo.company_id != user.company_id:
        raise HTTPException(404, "No such logo")
    kit.logo_url = logo.url
    await db.commit()
    return await _logo_out(db, user.company_id, kit.logo_url)


@router.delete("/logos/{logo_id}", response_model=list[BrandLogoOut])
async def delete_brand_logo(logo_id: str, user: User = Depends(require_capability("manage_brand_kit")), db: AsyncSession = Depends(get_db)):
    kit = await _get_or_create(db, user.company_id)
    logo = await db.get(BrandLogo, logo_id)
    if logo is None or logo.company_id != user.company_id:
        raise HTTPException(404, "No such logo")
    was_active = logo.url == kit.logo_url
    await db.delete(logo)
    if was_active:
        # Fall back to whatever's left, if anything — never leave the
        # gallery non-empty but generation pointing at a deleted logo.
        remaining = (await db.scalars(select(BrandLogo).where(BrandLogo.company_id == user.company_id, BrandLogo.id != logo.id).order_by(BrandLogo.created_at.asc()))).first()
        kit.logo_url = remaining.url if remaining else None
    await db.commit()
    return await _logo_out(db, user.company_id, kit.logo_url)


async def _shot_out(db: AsyncSession, company_id) -> list[BrandVideoShotOut]:
    rows = (await db.scalars(
        select(BrandVideoShot).where(BrandVideoShot.company_id == company_id).order_by(BrandVideoShot.created_at.asc())
    )).all()
    # Built explicitly (not model_validate(row)) — pydantic v2 does NOT
    # auto-coerce a UUID column value into a `str` field even with
    # from_attributes, so that would raise a validation error on every
    # single response.
    return [
        BrandVideoShotOut(
            id=str(r.id), kind=r.kind, status=r.status, label=r.label, prompt=r.prompt, duration=r.duration, ratio=r.ratio, mute_audio=r.mute_audio,
            url=r.url, poster_url=r.poster_url, error=r.error, created_at=r.created_at,
            reference_logo_id=str(r.reference_logo_id) if r.reference_logo_id else None,
            overlay_text=r.overlay_text, overlay_font=r.overlay_font, overlay_font_size=r.overlay_font_size, overlay_text_color=r.overlay_text_color, overlay_position=r.overlay_position,
        )
        for r in rows
    ]


@router.get("/video-shots", response_model=list[BrandVideoShotOut])
async def list_brand_video_shots(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Both intro and outro shots together, flat — the frontend splits
    by `kind`. Includes ones still `queued`/`running` so the gallery can
    show a generating card with a spinner; poll this endpoint while any
    entry is in that state, same pattern as ad video generation."""
    return await _shot_out(db, user.company_id)


@router.post("/video-shots", response_model=list[BrandVideoShotOut])
async def generate_brand_video_shot_endpoint(data: GenerateBrandVideoShotIn, user: User = Depends(require_capability("manage_brand_kit")), db: AsyncSession = Depends(get_db)):
    existing = (await db.scalars(select(BrandVideoShot).where(BrandVideoShot.company_id == user.company_id, BrandVideoShot.kind == data.kind))).all()
    if len(existing) >= MAX_SHOTS_PER_KIND:
        raise HTTPException(422, f"You can keep up to {MAX_SHOTS_PER_KIND} {data.kind} shots — delete one before generating another.")

    model = await credit_svc.resolve_model(db, "video", data.model_id)
    if model is None:
        raise HTTPException(422, "That video model isn't available.")

    available_ratios = await video_ratios_svc.get_video_ratios(db)
    if data.ratio not in available_ratios:
        raise HTTPException(422, f'"{data.ratio}" isn\'t one of the available ratios: {", ".join(available_ratios)}.')

    reference_logo_id = None
    if data.reference_logo_id:
        logo = await db.get(BrandLogo, data.reference_logo_id)
        if logo is None or logo.company_id != user.company_id:
            raise HTTPException(422, "That logo isn't in your Brand Kit.")
        reference_logo_id = logo.id

    cost = model["credits"]  # representative cost for this model — same simplification AvailableModelOut documents; dynamic-pricing models are charged their base rate here rather than a duration-specific recompute
    bal = await credit_svc.balance(db, user.company_id)
    if bal < cost:
        raise HTTPException(402, f"Not enough credits: generating this shot costs {cost}, you have {bal}.")

    shot = BrandVideoShot(
        company_id=user.company_id, kind=data.kind, label=data.label.strip(), prompt=data.prompt, duration=data.duration, ratio=data.ratio,
        mute_audio=data.mute_audio,
        model_used=model["model"], status="queued",
        reference_logo_id=reference_logo_id,
        overlay_text=(data.overlay_text or None), overlay_font=data.overlay_font, overlay_font_size=data.overlay_font_size, overlay_text_color=data.overlay_text_color, overlay_position=data.overlay_position,
    )
    db.add(shot)
    db.add(CreditLedger(company_id=user.company_id, delta=-cost, reason="generation", ref_id=None))
    await db.flush()
    shot_id = shot.id
    await db.commit()

    celery_app.send_task("app.generate_brand_video_shot", args=[str(shot_id)])
    return await _shot_out(db, user.company_id)


@router.put("/video-shots/{shot_id}", response_model=list[BrandVideoShotOut])
async def rename_brand_video_shot(shot_id: str, data: UpdateBrandVideoShotIn, user: User = Depends(require_capability("manage_brand_kit")), db: AsyncSession = Depends(get_db)):
    """Renaming only — everything else about a shot (prompt, overlay,
    reference logo, ratio) is fixed once generated, since editing any
    of those would mean the video no longer matches what's actually
    stored. Delete and regenerate for anything beyond the display name."""
    shot = await db.get(BrandVideoShot, shot_id)
    if shot is None or shot.company_id != user.company_id:
        raise HTTPException(404, "No such shot")
    shot.label = data.label.strip()
    await db.commit()
    return await _shot_out(db, user.company_id)


@router.delete("/video-shots/{shot_id}", response_model=list[BrandVideoShotOut])
async def delete_brand_video_shot(shot_id: str, user: User = Depends(require_capability("manage_brand_kit")), db: AsyncSession = Depends(get_db)):
    """Ads that already stitched this shot into a finished video keep
    that finished video exactly as it is — deleting only stops it being
    selectable for FUTURE generations. See tasks.py's stitching step,
    which already tolerates a since-deleted shot id gracefully."""
    shot = await db.get(BrandVideoShot, shot_id)
    if shot is None or shot.company_id != user.company_id:
        raise HTTPException(404, "No such shot")
    await db.delete(shot)
    await db.commit()
    return await _shot_out(db, user.company_id)


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

    # Image padding — same handling, independent fields (see
    # services/reframe.py for why these are split from video's above).
    if data.image_vertical_pad_mode is not None and data.image_vertical_pad_mode in VALID_PAD_MODES:
        kit.image_vertical_pad_mode = data.image_vertical_pad_mode
    if data.image_horizontal_pad_mode is not None and data.image_horizontal_pad_mode in VALID_PAD_MODES:
        kit.image_horizontal_pad_mode = data.image_horizontal_pad_mode
    for field, image_attr in [
        ("image_pad_top_image", "image_pad_top_image_url"), ("image_pad_bottom_image", "image_pad_bottom_image_url"),
        ("image_pad_left_image", "image_pad_left_image_url"), ("image_pad_right_image", "image_pad_right_image_url"),
    ]:
        value = getattr(data, field)
        if value is not None:
            setattr(kit, image_attr, None if value == "" else upload_data_url(value, prefix="brand"))
    if data.image_vertical_pad_color is not None:
        kit.image_vertical_pad_color = data.image_vertical_pad_color or None
    if data.image_horizontal_pad_color is not None:
        kit.image_horizontal_pad_color = data.image_horizontal_pad_color or None
    await db.commit()
    await db.refresh(kit)
    return kit


@router.put("/platform-ratio", response_model=BrandKitOut)
async def set_platform_ratio_override(data: PlatformRatioOverrideIn, user: User = Depends(require_capability("manage_brand_kit")), db: AsyncSession = Depends(get_db)):
    """Set (ratio given) or clear (ratio=null) this company's own
    override of one platform's video ratio — the reframe pipeline reads
    this before falling back to the developer's platform-wide default.
    Reassigns the whole dict (not an in-place mutation) so SQLAlchemy's
    change tracking on the JSON column actually detects the update."""
    if data.ratio is not None:
        valid_ratios = await video_ratios_svc.get_video_ratios(db)
        if data.ratio not in valid_ratios:
            raise HTTPException(422, f"\"{data.ratio}\" isn't one of the platform's available ratios ({', '.join(valid_ratios)}).")
    kit = await _get_or_create(db, user.company_id)
    overrides = dict(kit.platform_ratio_overrides or {})
    if data.ratio is None:
        overrides.pop(data.platform_id, None)
    else:
        overrides[data.platform_id] = data.ratio
    kit.platform_ratio_overrides = overrides
    await db.commit()
    await db.refresh(kit)
    return kit
