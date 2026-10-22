from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..auth import Db, StaffUser
from ..cart_service import CartService
from ..checkout_service import CheckoutService
from ..models import Inventory, Product
from ..pricing import current_prices
from ..schemas import ExitCheckRequest

router = APIRouter(prefix="/admin/v1")


@router.get("/stores/{store_id}/inventory")
async def inventory(
    store_id: str,
    _: StaffUser,
    db: Db,
    q: str | None = None,
    lowStockOnly: Annotated[Literal["true", "false"], Query()] = "false",
) -> dict[str, Any]:
    """Dashboard inventory table: stock, reservations, thresholds and location for every product."""
    stmt = (
        select(Inventory)
        .join(Product, Product.id == Inventory.product_id)
        .where(Inventory.store_id == store_id)
        .options(selectinload(Inventory.product).selectinload(Product.barcodes))
        .order_by(Inventory.aisle.asc().nulls_last(), Product.name)
    )
    if q and q.strip():
        stmt = stmt.where(Product.name.ilike(f"%{q.strip()}%"))
    rows = list(await db.scalars(stmt))
    prices = await current_prices(db, store_id, [r.product_id for r in rows])

    items = []
    for r in rows:
        available = r.on_hand - r.reserved
        low = available <= r.low_stock_threshold
        if lowStockOnly == "true" and not low:
            continue
        price = prices.get(r.product_id)
        items.append(
            {
                "productId": r.product_id,
                "name": r.product.name,
                "brand": r.product.brand,
                "category": r.product.category,
                "barcode": r.product.barcodes[0].code if r.product.barcodes else None,
                "pricePaise": price.price_paise if price else None,
                "onHand": r.on_hand,
                "reserved": r.reserved,
                "available": available,
                "lowStockThreshold": r.low_stock_threshold,
                "lowStock": low,
                "aisle": r.aisle,
                "shelf": r.shelf,
                "updatedAt": r.updated_at.isoformat() + "Z",
            }
        )
    return {"storeId": store_id, "items": items}


@router.get("/stores/{store_id}/carts")
async def carts(store_id: str, _: StaffUser, db: Db, request: Request) -> dict[str, Any]:
    """Dashboard: open cart sessions with shopper, item count and running total."""
    service: CartService = request.app.state.carts
    return {"storeId": store_id, "sessions": await service.active_in_store(db, store_id)}


@router.get("/stores/{store_id}/orders")
async def orders(store_id: str, _: StaffUser, db: Db, request: Request) -> dict[str, Any]:
    """Recent orders for the dashboard, newest first."""
    service: CheckoutService = request.app.state.checkout
    return {"storeId": store_id, "orders": await service.store_orders(db, store_id)}


@router.post("/stores/{store_id}/exit-checks")
async def exit_check(
    store_id: str, body: ExitCheckRequest, _: StaffUser, db: Db, request: Request
) -> dict[str, Any]:
    """Staff at the door check a shopper's exit code (typed, or the scanned exit QR)."""
    service: CheckoutService = request.app.state.checkout
    return (await service.check_exit(db, store_id, body.code)).wire()
