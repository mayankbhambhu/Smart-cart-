"""Find it fast (milestone 4): product search, list routing, floor help and the insights behind them.

These map to the capstone user stories US-01 to US-10. The guardrail from the brief holds throughout:
answers come only from the store's own data. Stock is stated from inventory counts, and a line we
cannot match is reported as not found, never guessed.
"""

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .errors import ApiError
from .models import (
    Cart,
    CartEvent,
    CartSession,
    CartSessionStatus,
    HelpRequest,
    HelpStatus,
    Inventory,
    Product,
    SearchLog,
    User,
    utcnow,
)
from .pricing import current_prices
from .schemas import Source, cart_room, event, store_room

Publish = Callable[[dict[str, Any], list[str]], Awaitable[None]]

DIETS = ("veg", "jain", "no_added_sugar")
HELP_TOPICS = ("find_item", "price", "stock", "other")

# Everyday Hindi and Marathi words shoppers type for catalogue terms.
SYNONYMS = {
    "doodh": "milk",
    "curd": "dahi",
    "chawal": "rice",
    "haldi": "turmeric",
    "mirchi": "chilli",
    "chilly": "chilli",
    "cheeni": "sugar",
    "shakkar": "sugar",
    "namak": "salt",
    "tel": "oil",
    "chai": "tea",
    "anda": "eggs",
    "makhan": "butter",
    "wheat": "atta",
    "flour": "atta",
    "rava": "sooji",
    "suji": "sooji",
    "semolina": "sooji",
    "gram": "besan",
    "nappies": "diapers",
}
# Quantities and units in a typed list ("2 kg atta", "milk x2") that are not part of the product.
_NOISE = re.compile(r"^(\d+(\.\d+)?|x\d*|\d+x|kg|g|gm|gms|l|ltr|litre|liter|ml|pcs?|packs?|of|and|the|a)$")
_PACK = re.compile(r"(\d+(?:\.\d+)?)\s*(kg|g|l|ml|pcs|pads|rolls|bags)\b(?:\s*x\s*(\d+))?", re.IGNORECASE)


def query_words(text: str) -> list[str]:
    words = []
    for raw in re.split(r"[\s,]+", text.lower()):
        w = raw.strip("?!.,;:()-'\"")
        if not w or _NOISE.match(w):
            continue
        w = SYNONYMS.get(w, w)
        if len(w) > 4 and w.endswith("s"):
            w = w[:-1]  # "biscuits" still matches "Biscuits"; "tomatoes" matches "Tomato"
        words.append(w)
    return words[:6]


def pack_size(name: str) -> tuple[float, str] | None:
    """The pack size printed in a product name, normalised to kg, L or pieces."""
    m = _PACK.search(name)
    if not m:
        return None
    qty, unit, multiple = float(m.group(1)), m.group(2).lower(), int(m.group(3) or 1)
    if unit == "g":
        return qty * multiple / 1000, "kg"
    if unit == "ml":
        return qty * multiple / 1000, "L"
    if unit in ("kg", "l"):
        return qty * multiple, unit.upper() if unit == "l" else "kg"
    return qty * multiple, "pc"


def unit_price(price_paise: int, name: str) -> tuple[int | None, str | None]:
    """Price per kg, per litre or per piece, so shoppers can compare brands and pack sizes (US-04)."""
    size = pack_size(name)
    if not size or size[0] <= 0:
        return None, None
    return round(price_paise / size[0]), size[1]


def stock_status(stock: Inventory | None) -> str:
    """in_stock, low or out from verified inventory; unknown when the store has no count (US-05)."""
    if stock is None:
        return "unknown"
    available = stock.on_hand - stock.reserved
    if available <= 0:
        return "out"
    return "low" if available <= stock.low_stock_threshold else "in_stock"


def aisle_key(aisle: str | None, shelf: str | None) -> tuple[str, int, int]:
    """Walking order through the store: A1, A2, A3, B1, ... then shelf. Unknown locations go last."""
    if not aisle:
        return ("~", 0, 0)
    m = re.match(r"([A-Za-z]+)(\d*)", aisle)
    letter, number = (m.group(1).upper(), int(m.group(2) or 0)) if m else (aisle, 0)
    return (letter, number, int(shelf) if shelf and shelf.isdigit() else 0)


_STOCK_RANK = {"in_stock": 0, "low": 1, "unknown": 2, "out": 3}


@dataclass
class HelpView:
    request: HelpRequest
    shopper_name: str | None

    def wire(self) -> dict[str, Any]:
        r = self.request
        return {
            "id": r.id,
            "storeId": r.store_id,
            "cartId": r.cart_id,
            "aisle": r.aisle,
            "topic": r.topic,
            "note": r.note,
            "status": r.status.value,
            "shopperName": self.shopper_name,
            "createdAt": r.created_at.isoformat() + "Z",
            "acknowledgedAt": r.acknowledged_at.isoformat() + "Z" if r.acknowledged_at else None,
            "resolvedAt": r.resolved_at.isoformat() + "Z" if r.resolved_at else None,
        }


class AssistService:
    def __init__(self, publish: Publish) -> None:
        self.publish = publish

    # ---- Search and lists ----------------------------------------------------------------------

    async def search(
        self,
        db: AsyncSession,
        store_id: str,
        q: str,
        *,
        diet: list[str] | None = None,
        limit: int = 20,
        source: str | None = "search",
    ) -> list[dict[str, Any]]:
        """Products matching every word, with aisle, shelf, stock and unit price (US-02, US-03, US-05).

        Cheapest per kg or litre first, so a brand comparison is the default order. Every search is
        logged (unless source is None) so the operations lead can see which ones found nothing.
        """
        words = query_words(q)
        if not words or len(q) > 100:
            raise ApiError(400, "invalid_query")
        diet = [d for d in (diet or []) if d in DIETS]
        stmt = select(Product, Inventory).join(
            Inventory, (Inventory.product_id == Product.id) & (Inventory.store_id == store_id)
        )
        for w in words:
            pattern = f"%{w}%"
            stmt = stmt.where(
                Product.name.ilike(pattern) | Product.brand.ilike(pattern) | Product.category.ilike(pattern)
            )
        if diet:
            stmt = stmt.where(Product.diet_tags.contains(diet))
        rows = (await db.execute(stmt.limit(200))).all()
        prices = await current_prices(db, store_id, [p.id for p, _ in rows])
        results = []
        for product, stock in rows:
            price = prices.get(product.id)
            if price is None:
                continue
            per_unit, unit = unit_price(price.price_paise, product.name)
            results.append(
                {
                    "productId": product.id,
                    "name": product.name,
                    "brand": product.brand,
                    "category": product.category,
                    "pricePaise": price.price_paise,
                    "mrpPaise": price.mrp_paise,
                    "unitPricePaise": per_unit,
                    "unit": unit,
                    "dietTags": list(product.diet_tags),
                    "aisle": stock.aisle,
                    "shelf": stock.shelf,
                    "stock": stock_status(stock),
                }
            )
        results.sort(key=lambda r: (r["unitPricePaise"] is None, r["unitPricePaise"] or 0, r["name"]))
        if source:
            await self.log_search(db, store_id, q, source, len(results))
        return results[: max(1, min(limit, 50))]

    async def log_search(self, db: AsyncSession, store_id: str, q: str, source: str, results: int) -> None:
        db.add(SearchLog(store_id=store_id, query=q.strip()[:100], source=source, result_count=results))
        await db.commit()

    async def route_list(self, db: AsyncSession, store_id: str, lines: list[str]) -> dict[str, Any]:
        """Turns a typed or pasted shopping list into a walking route, aisle by aisle (US-01, US-06).

        Each line gets the best match: in stock first, then the pack size the line names ("atta 5 kg"),
        then the lowest unit price. Lines with no match
        are returned as notFound rather than swapped for something else.
        """
        cleaned = [ln.strip() for ln in lines if ln.strip()][:60]
        if not cleaned:
            raise ApiError(400, "empty_list")
        picked: list[dict[str, Any]] = []
        not_found: list[str] = []
        for line in cleaned:
            if not query_words(line):
                not_found.append(line)
                continue
            matches = await self.search(db, store_id, line, limit=50, source="list")
            if not matches:
                not_found.append(line)
                continue
            wanted = pack_size(line)
            best = min(
                matches,
                key=lambda m: (
                    _STOCK_RANK[m["stock"]],
                    wanted is not None and pack_size(m["name"]) != wanted,
                    m["unitPricePaise"] or 1 << 30,
                ),
            )
            picked.append({"line": line, "product": best, "alternatives": len(matches) - 1})

        picked.sort(key=lambda p: aisle_key(p["product"]["aisle"], p["product"]["shelf"]))
        stops: list[dict[str, Any]] = []
        for p in picked:
            aisle = p["product"]["aisle"] or "?"
            if not stops or stops[-1]["aisle"] != aisle:
                stops.append({"aisle": aisle, "category": p["product"]["category"], "items": []})
            stops[-1]["items"].append(p)
        return {"stops": stops, "notFound": not_found, "matched": len(picked), "total": len(cleaned)}

    # ---- Floor help ----------------------------------------------------------------------------

    async def request_help(
        self,
        db: AsyncSession,
        *,
        store_id: str,
        user_id: str,
        user_name: str | None,
        topic: str,
        note: str | None,
    ) -> HelpView:
        """A shopper calls for staff (US-07). The aisle comes from the last item they scanned, so the
        floor assistant knows where to walk (US-09). One open request per shopper."""
        if topic not in HELP_TOPICS:
            raise ApiError(400, "invalid_topic")
        existing = await db.scalar(
            select(HelpRequest).where(
                HelpRequest.user_id == user_id,
                HelpRequest.store_id == store_id,
                HelpRequest.status.in_([HelpStatus.open, HelpStatus.acknowledged]),
            )
        )
        if existing:
            return HelpView(existing, user_name)

        session = await self._open_session(db, store_id, user_id)
        aisle = await self._last_aisle(db, store_id, session.id) if session else None
        req = HelpRequest(
            store_id=store_id,
            user_id=user_id,
            cart_id=session.cart_id if session else None,
            aisle=aisle,
            topic=topic,
            note=(note or "").strip()[:200] or None,
        )
        db.add(req)
        await db.commit()
        await db.refresh(req)
        view = HelpView(req, user_name)
        await self._announce("help.requested", view, session, source="phone")
        return view

    async def update_help(
        self, db: AsyncSession, *, store_id: str, request_id: str, action: str, actor_id: str, staff: bool
    ) -> HelpView:
        req = await db.get(HelpRequest, request_id)
        if req is None or req.store_id != store_id or (not staff and req.user_id != actor_id):
            raise ApiError(404, "help_request_not_found")
        if req.status in (HelpStatus.resolved, HelpStatus.cancelled):
            raise ApiError(409, "help_request_closed")
        now = utcnow()
        if staff and action == "acknowledge":
            req.status, req.acknowledged_at, req.handled_by = HelpStatus.acknowledged, now, actor_id
        elif staff and action == "resolve":
            req.status, req.resolved_at, req.handled_by = HelpStatus.resolved, now, actor_id
            req.acknowledged_at = req.acknowledged_at or now
        elif not staff and action == "cancel":
            req.status, req.resolved_at = HelpStatus.cancelled, now
        else:
            raise ApiError(400, "invalid_action")
        await db.commit()
        name = await self._user_name(db, req.user_id)
        view = HelpView(req, name)
        session = await self._open_session(db, store_id, req.user_id)
        await self._announce("help.updated", view, session, source="staff" if staff else "phone")
        return view

    async def store_help(self, db: AsyncSession, store_id: str, *, open_only: bool) -> list[dict[str, Any]]:
        stmt = select(HelpRequest).where(HelpRequest.store_id == store_id)
        if open_only:
            stmt = stmt.where(HelpRequest.status.in_([HelpStatus.open, HelpStatus.acknowledged]))
        else:
            stmt = stmt.where(HelpRequest.created_at >= utcnow() - timedelta(days=1))
        rows = list(await db.scalars(stmt.order_by(HelpRequest.created_at.desc()).limit(100)))
        names = {r.user_id: await self._user_name(db, r.user_id) for r in rows}
        return [HelpView(r, names[r.user_id]).wire() for r in rows]

    async def my_help(self, db: AsyncSession, store_id: str, user_id: str) -> dict[str, Any] | None:
        req = await db.scalar(
            select(HelpRequest)
            .where(HelpRequest.store_id == store_id, HelpRequest.user_id == user_id)
            .order_by(HelpRequest.created_at.desc())
            .limit(1)
        )
        return HelpView(req, None).wire() if req else None

    # ---- Insights for the operations lead (US-10) -----------------------------------------------

    async def insights(self, db: AsyncSession, store_id: str, days: int = 7) -> dict[str, Any]:
        since = utcnow() - timedelta(days=max(1, min(days, 90)))
        searches = await db.scalar(
            select(func.count()).where(SearchLog.store_id == store_id, SearchLog.at >= since)
        )
        missed_rows = await db.execute(
            select(func.lower(SearchLog.query), func.count(), func.max(SearchLog.at))
            .where(SearchLog.store_id == store_id, SearchLog.at >= since, SearchLog.result_count == 0)
            .group_by(func.lower(SearchLog.query))
            .order_by(func.count().desc(), func.max(SearchLog.at).desc())
            .limit(15)
        )
        missed = [{"query": q, "count": n, "lastAt": at.isoformat() + "Z"} for q, n, at in missed_rows]
        missed_total = sum(m["count"] for m in missed)

        help_rows = list(
            await db.scalars(
                select(HelpRequest).where(HelpRequest.store_id == store_id, HelpRequest.created_at >= since)
            )
        )
        waits = [
            (r.acknowledged_at - r.created_at).total_seconds() / 60 for r in help_rows if r.acknowledged_at
        ]
        by_topic: dict[str, int] = {}
        by_aisle: dict[str, int] = {}
        for r in help_rows:
            by_topic[r.topic] = by_topic.get(r.topic, 0) + 1
            if r.aisle:
                by_aisle[r.aisle] = by_aisle.get(r.aisle, 0) + 1
        return {
            "days": days,
            "searches": searches or 0,
            "missedSearches": missed_total,
            "topMissed": missed,
            "help": {
                "total": len(help_rows),
                "open": sum(r.status in (HelpStatus.open, HelpStatus.acknowledged) for r in help_rows),
                "avgMinutesToAcknowledge": round(sum(waits) / len(waits), 1) if waits else None,
                "byTopic": by_topic,
                "byAisle": dict(sorted(by_aisle.items(), key=lambda kv: -kv[1])),
            },
        }

    # ---- Helpers -------------------------------------------------------------------------------

    async def _open_session(self, db: AsyncSession, store_id: str, user_id: str) -> CartSession | None:
        return await db.scalar(
            select(CartSession)
            .join(Cart, Cart.id == CartSession.cart_id)
            .where(
                CartSession.user_id == user_id,
                Cart.store_id == store_id,
                CartSession.status.in_([CartSessionStatus.active, CartSessionStatus.checking_out]),
            )
        )

    async def _last_aisle(self, db: AsyncSession, store_id: str, session_id: str) -> str | None:
        return await db.scalar(
            select(Inventory.aisle)
            .join(CartEvent, CartEvent.product_id == Inventory.product_id)
            .where(
                CartEvent.session_id == session_id,
                CartEvent.type == "item.added",
                Inventory.store_id == store_id,
            )
            .order_by(CartEvent.at.desc())
            .limit(1)
        )

    async def _user_name(self, db: AsyncSession, user_id: str) -> str | None:
        user = await db.get(User, user_id)
        return user.name if user else None

    async def _announce(
        self, type_: str, view: HelpView, session: CartSession | None, *, source: Source
    ) -> None:
        rooms = [store_room(view.request.store_id)]
        if session:
            rooms.append(cart_room(session.id))
        await self.publish(
            event(
                type_,
                store_id=view.request.store_id,
                cart_id=view.request.cart_id,
                source=source,
                data=view.wire(),
            ),
            rooms,
        )
