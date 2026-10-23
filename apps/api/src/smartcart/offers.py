"""Aisle deals (US-08): managers put a product on offer for a time window, and shoppers hear about
the deals in the aisle they are standing in.

A running offer's price is the product's price everywhere (see pricing.current_prices). Managers
decide offers; nothing here sets a price on its own, and an offer can only lower a price.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .assist_service import aisle_key, stock_status, with_diet
from .errors import ApiError
from .models import AuditLog, Inventory, Offer, Product, utcnow
from .pricing import active_offer_filter, current_prices

MAX_DAYS = 31
# Ended offers stay on the manager's list this long, so they can see what ran.
KEEP_ENDED_DAYS = 7


def _naive_utc(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() + "Z" if value else None


def offer_status(o: Offer, now: datetime) -> str:
    if o.ended_at or o.ends_at <= now:
        return "ended"
    return "scheduled" if o.starts_at > now else "running"


async def shopper_offers(
    db: AsyncSession, store_id: str, *, aisle: str | None = None, diet: list[str] | None = None
) -> list[dict[str, Any]]:
    """Deals running now, in walking order, optionally only those in one aisle. Diet preferences
    apply here as they do to search: a vegetarian isn't told about a chicken deal."""
    stmt = (
        select(Offer, Product, Inventory)
        .join(Product, Product.id == Offer.product_id)
        .join(Inventory, (Inventory.product_id == Offer.product_id) & (Inventory.store_id == store_id))
        .where(*active_offer_filter(store_id, utcnow()))
    )
    if aisle:
        stmt = stmt.where(Inventory.aisle == aisle.strip().upper())
    rows = list((await db.execute(with_diet(stmt, diet))).all())
    prices = await current_prices(db, store_id, [p.id for _, p, _ in rows])
    out = []
    for offer, product, stock in rows:
        price = prices.get(product.id)
        # Only the offer actually in force (the lowest, if a manager overlapped two).
        if price is None or price.offer is None or price.offer.id != offer.id:
            continue
        out.append(
            {
                "id": offer.id,
                "title": offer.title,
                "productId": product.id,
                "name": product.name,
                "brand": product.brand,
                "foodType": product.food_type.value if product.food_type else None,
                "aisle": stock.aisle,
                "shelf": stock.shelf,
                "stock": stock_status(stock),
                "offerPricePaise": price.price_paise,
                "regularPaise": price.offer.regular_paise,
                "savingsPaise": price.offer.regular_paise - price.price_paise,
                "endsAt": _iso(offer.ends_at),
            }
        )
    out.sort(key=lambda o: (aisle_key(o["aisle"], o["shelf"]), o["name"]))
    return out


async def manager_offers(db: AsyncSession, store_id: str) -> list[dict[str, Any]]:
    """Running and scheduled offers, then ones that ended in the last week."""
    now = utcnow()
    since = now - timedelta(days=KEEP_ENDED_DAYS)
    rows = list(
        (
            await db.execute(
                select(Offer, Product, Inventory)
                .join(Product, Product.id == Offer.product_id)
                .join(
                    Inventory,
                    (Inventory.product_id == Offer.product_id) & (Inventory.store_id == store_id),
                )
                .where(Offer.store_id == store_id, Offer.ends_at >= since)
            )
        ).all()
    )
    prices = await current_prices(db, store_id, [p.id for _, p, _ in rows])
    order = {"running": 0, "scheduled": 1, "ended": 2}
    out = []
    for offer, product, stock in rows:
        if offer.ended_at and offer.ended_at < since:
            continue
        price = prices.get(product.id)
        regular = (
            (price.offer.regular_paise if price and price.offer else price.price_paise) if price else None
        )
        out.append(_manager_wire(offer, product.name, stock.aisle, stock.shelf, regular, now))
    out.sort(key=lambda o: (order[o["status"]], o["startsAt"] if o["status"] == "scheduled" else o["endsAt"]))
    return out


def _manager_wire(
    o: Offer, name: str, aisle: str | None, shelf: str | None, regular: int | None, now: datetime
) -> dict[str, Any]:
    return {
        "id": o.id,
        "title": o.title,
        "productId": o.product_id,
        "name": name,
        "aisle": aisle,
        "shelf": shelf,
        "offerPricePaise": o.offer_price_paise,
        "regularPaise": regular,
        "startsAt": _iso(o.starts_at),
        "endsAt": _iso(o.ends_at),
        "endedAt": _iso(o.ended_at),
        "status": offer_status(o, now),
    }


async def create_offer(db: AsyncSession, store_id: str, user_id: str, body: dict[str, Any]) -> dict[str, Any]:
    now = utcnow()
    product = await db.get(Product, body["product_id"])
    stock = await db.get(Inventory, (store_id, body["product_id"]))
    if product is None or stock is None:
        raise ApiError(404, "product_not_found")
    price = (await current_prices(db, store_id, [product.id])).get(product.id)
    if price is None:
        raise ApiError(409, "product_not_priced")
    regular = price.offer.regular_paise if price.offer else price.price_paise
    if body["offer_price_paise"] >= regular:
        raise ApiError(400, "offer_price_not_lower", regularPaise=regular)
    starts = max(_naive_utc(body["starts_at"]), now) if body.get("starts_at") else now
    ends = _naive_utc(body["ends_at"])
    if ends <= starts or ends - starts > timedelta(days=MAX_DAYS):
        raise ApiError(400, "invalid_offer_window", maxDays=MAX_DAYS)
    clash = await db.scalar(
        select(Offer.id).where(
            Offer.store_id == store_id,
            Offer.product_id == product.id,
            Offer.ended_at.is_(None),
            Offer.starts_at < ends,
            Offer.ends_at > starts,
        )
    )
    if clash:
        raise ApiError(409, "offer_exists", offerId=clash)
    offer = Offer(
        store_id=store_id,
        product_id=product.id,
        title=body["title"].strip(),
        offer_price_paise=body["offer_price_paise"],
        starts_at=starts,
        ends_at=ends,
        created_by=user_id,
    )
    db.add(offer)
    await db.flush()
    db.add(
        AuditLog(
            actor_id=user_id,
            action="offer.created",
            target=offer.id,
            details={
                "productId": product.id,
                "offerPricePaise": offer.offer_price_paise,
                "regularPaise": regular,
            },
        )
    )
    await db.commit()
    return _manager_wire(offer, product.name, stock.aisle, stock.shelf, regular, now)


async def end_offer(db: AsyncSession, store_id: str, offer_id: str, user_id: str) -> dict[str, Any]:
    offer = await db.get(Offer, offer_id)
    if offer is None or offer.store_id != store_id:
        raise ApiError(404, "offer_not_found")
    now = utcnow()
    if offer_status(offer, now) == "ended":
        raise ApiError(409, "offer_ended")
    offer.ended_at = now
    db.add(AuditLog(actor_id=user_id, action="offer.ended", target=offer.id, details=None))
    await db.commit()
    product = await db.get_one(Product, offer.product_id)
    stock = await db.get(Inventory, (store_id, offer.product_id))
    price = (await current_prices(db, store_id, [product.id])).get(product.id)
    regular = price.price_paise if price else None
    return _manager_wire(
        offer, product.name, stock.aisle if stock else None, stock.shelf if stock else None, regular, now
    )
