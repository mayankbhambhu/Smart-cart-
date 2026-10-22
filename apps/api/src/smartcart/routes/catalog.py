from typing import Any

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..auth import Db
from ..errors import ApiError
from ..models import Barcode, Inventory, Product, Store
from ..pricing import current_prices

router = APIRouter(prefix="/v1")


@router.get("/stores")
async def stores(db: Db) -> dict[str, Any]:
    """Stores the shopper can pick on the home screen."""
    rows = await db.scalars(select(Store).order_by(Store.id))
    return {"stores": [{"id": s.id, "name": s.name, "city": s.city} for s in rows]}


@router.get("/products/barcode/{code}")
async def product_by_barcode(code: str, db: Db, storeId: str = "S-01") -> dict[str, Any]:
    """Product preview shown on the phone before the shopper confirms adding it."""
    if not (code.isdigit() and 8 <= len(code) <= 14):
        raise ApiError(400, "invalid_barcode")
    barcode = await db.scalar(
        select(Barcode).where(Barcode.code == code).options(selectinload(Barcode.product))
    )
    if barcode is None:
        raise ApiError(404, "product_not_found")
    product: Product = barcode.product
    price = (await current_prices(db, storeId, [product.id])).get(product.id)
    if price is None:
        raise ApiError(404, "not_sold_in_store")
    stock = await db.get(Inventory, (storeId, product.id))
    return {
        "productId": product.id,
        "barcode": barcode.code,
        "name": product.name,
        "brand": product.brand,
        "category": product.category,
        "imageUrl": product.image_url,
        "gstRateBp": product.gst_rate_bp,
        "mrpPaise": price.mrp_paise,
        "pricePaise": price.price_paise,
        # Guardrail from the brief: only state availability from verified inventory.
        "inStock": (stock.on_hand - stock.reserved > 0) if stock else None,
        "aisle": stock.aisle if stock else None,
    }
