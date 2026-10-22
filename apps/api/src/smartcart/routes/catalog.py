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


def stock_status(stock: Inventory | None) -> str:
    """in_stock / low / out from verified inventory, or unknown when the store has no count."""
    if stock is None:
        return "unknown"
    available = stock.on_hand - stock.reserved
    if available <= 0:
        return "out"
    return "low" if available <= stock.low_stock_threshold else "in_stock"


def unit_price(price_paise: int, weight_g: int | None) -> int | None:
    """Paise per kg (or per litre, since the catalogue stores ml as g), for comparing pack sizes."""
    return round(price_paise * 1000 / weight_g) if weight_g else None


@router.get("/stores/{store_id}/products/search")
async def search_products(store_id: str, db: Db, q: str, limit: int = 20) -> dict[str, Any]:
    """Finds products by name, brand or category, with where they are and whether they are in stock.
    Results are cheapest per kg first within each match group, so shoppers can compare brands."""
    words = [w for w in q.lower().split() if w][:6]
    if not words or len(q) > 100:
        raise ApiError(400, "invalid_query")
    stmt = select(Product, Inventory).join(
        Inventory, (Inventory.product_id == Product.id) & (Inventory.store_id == store_id)
    )
    for w in words:
        pattern = f"%{w}%"
        stmt = stmt.where(
            Product.name.ilike(pattern) | Product.brand.ilike(pattern) | Product.category.ilike(pattern)
        )
    rows = (await db.execute(stmt.limit(max(1, min(limit, 50))))).all()
    prices = await current_prices(db, store_id, [p.id for p, _ in rows])
    results = []
    for product, stock in rows:
        price = prices.get(product.id)
        if price is None:
            continue
        results.append(
            {
                "productId": product.id,
                "name": product.name,
                "brand": product.brand,
                "category": product.category,
                "pricePaise": price.price_paise,
                "mrpPaise": price.mrp_paise,
                "weightG": product.weight_g,
                "unitPricePaisePerKg": unit_price(price.price_paise, product.weight_g),
                "aisle": stock.aisle,
                "shelf": stock.shelf,
                "stock": stock_status(stock),
            }
        )
    results.sort(key=lambda r: (r["unitPricePaisePerKg"] is None, r["unitPricePaisePerKg"] or 0))
    return {"query": q, "results": results}
