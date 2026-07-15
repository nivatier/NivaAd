import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_capability
from app.models import Product, User
from app.schemas import ProductCreateIn, ProductOut
from app.services.storage import upload_data_url

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=list[ProductOut])
async def list_products(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(
        select(Product).where(Product.company_id == user.company_id).order_by(Product.created_at.desc())
    )).all()
    return rows


@router.post("", response_model=ProductOut, status_code=201)
async def create_product(data: ProductCreateIn, user: User = Depends(require_capability("manage_products")), db: AsyncSession = Depends(get_db)):
    image_url = None
    if data.image:
        try:
            image_url = upload_data_url(data.image, prefix="products")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"Could not process the product photo: {exc}")

    product = Product(
        company_id=user.company_id, name=data.name, description=data.description,
        audience=data.audience, offer=data.offer, image_url=image_url,
    )
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return product


@router.delete("/{product_id}", status_code=204)
async def delete_product(product_id: uuid.UUID, user: User = Depends(require_capability("manage_products")), db: AsyncSession = Depends(get_db)):
    product = await db.get(Product, product_id)
    if product is None or product.company_id != user.company_id:
        raise HTTPException(404, "Product not found")
    await db.delete(product)
    await db.commit()
