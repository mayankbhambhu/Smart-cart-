"""Aisle deals (milestone 6, US-08): shoppers see what's on offer, aisle by aisle, and managers run
the offers. Only managers set offers; nothing here changes a price on its own."""

from typing import Annotated, Any

from fastapi import APIRouter, Query

from ..auth import Db, Manager
from ..offers import create_offer, end_offer, manager_offers, shopper_offers
from ..schemas import OfferCreateRequest

router = APIRouter(prefix="/v1/stores/{store_id}")
admin_router = APIRouter(prefix="/admin/v1/stores/{store_id}")


@router.get("/offers")
async def offers(
    store_id: str,
    db: Db,
    aisle: str | None = None,
    diet: Annotated[list[str] | None, Query()] = None,
) -> dict[str, Any]:
    """Deals running now in walking order, or only those in one aisle (what the app shows when the
    shopper's cart reaches that aisle). Diet preferences filter them like search."""
    return {
        "storeId": store_id,
        "aisle": aisle,
        "offers": await shopper_offers(db, store_id, aisle=aisle, diet=diet),
    }


@admin_router.get("/offers")
async def store_offers(store_id: str, _: Manager, db: Db) -> dict[str, Any]:
    """Running and scheduled offers, and those that ended in the last week."""
    return {"storeId": store_id, "offers": await manager_offers(db, store_id)}


@admin_router.post("/offers", status_code=201)
async def new_offer(store_id: str, body: OfferCreateRequest, staff: Manager, db: Db) -> dict[str, Any]:
    """Put a product on offer. The price must be below its regular price, and a product has one
    offer at a time. Recorded in the audit log."""
    return await create_offer(db, store_id, staff.user_id, body.model_dump())


@admin_router.post("/offers/{offer_id}/end")
async def stop_offer(store_id: str, offer_id: str, staff: Manager, db: Db) -> dict[str, Any]:
    """End an offer now; the product goes back to its regular price."""
    return await end_offer(db, store_id, offer_id, staff.user_id)
