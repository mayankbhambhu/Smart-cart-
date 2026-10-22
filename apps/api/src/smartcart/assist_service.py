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
    AuditLog,
    Cart,
    CartEvent,
    CartSession,
    CartSessionStatus,
    Category,
    FoodType,
    HelpRequest,
    HelpStatus,
    Inventory,
    Product,
    SearchLog,
    Section,
    User,
    utcnow,
)
from .pricing import current_prices
from .schemas import Source, cart_room, event, store_room
from .taxonomy import DIET_TAGS, FOOD_TYPES

Publish = Callable[[dict[str, Any], list[str]], Awaitable[None]]

# Shopper diet filters: "veg" means the green dot (food type), the rest are pack claims.
DIETS = ("veg", *DIET_TAGS)
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


def with_diet(stmt: Any, diet: list[str] | None) -> Any:
    """Shopper diet filters: "veg" keeps green-dot products only; tags must all be on the pack."""
    wanted = [d for d in (diet or []) if d in DIETS]
    if "veg" in wanted:
        stmt = stmt.where(Product.food_type == FoodType.veg)
    tags = [d for d in wanted if d != "veg"]
    return stmt.where(Product.diet_tags.contains(tags)) if tags else stmt


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
    # The floor assistant who took it, so the shopper sees who is coming.
    staff_name: str | None = None

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
            "staffName": self.staff_name,
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
        stmt = select(Product, Inventory).join(
            Inventory, (Inventory.product_id == Product.id) & (Inventory.store_id == store_id)
        )
        for w in words:
            pattern = f"%{w}%"
            stmt = stmt.where(
                Product.name.ilike(pattern) | Product.brand.ilike(pattern) | Product.category.ilike(pattern)
            )
        stmt = with_diet(stmt, diet)
        results = await self._wire(db, store_id, list((await db.execute(stmt.limit(200))).all()))
        results.sort(key=lambda r: (r["unitPricePaise"] is None, r["unitPricePaise"] or 0, r["name"]))
        if source:
            await self.log_search(db, store_id, q, source, len(results))
        return results[: max(1, min(limit, 50))]

    # ---- Browse by section ---------------------------------------------------------------------

    async def sections(self, db: AsyncSession, store_id: str) -> list[dict[str, Any]]:
        """Sections in shelf order, each with its categories and how many products this store has."""
        counts: dict[str | None, int] = dict(
            (
                await db.execute(
                    select(Product.category_id, func.count())
                    .join(Inventory, (Inventory.product_id == Product.id) & (Inventory.store_id == store_id))
                    .group_by(Product.category_id)
                )
            ).all()
        )
        sections = await db.scalars(select(Section).order_by(Section.sort_order))
        out: list[dict[str, Any]] = []
        for sec in sections:
            cats = [{"id": c.id, "name": c.name, "productCount": counts.get(c.id, 0)} for c in sec.categories]
            out.append(
                {
                    "id": sec.id,
                    "name": sec.name,
                    "icon": sec.icon,
                    "productCount": sum(counts.get(c.id, 0) for c in sec.categories),
                    "categories": cats,
                }
            )
        return out

    async def browse(
        self,
        db: AsyncSession,
        store_id: str,
        *,
        section: str | None,
        category: str | None,
        food_types: list[str],
        tags: list[str],
    ) -> list[dict[str, Any]]:
        """A section or category's products in shelf order, filtered by food type and diet claims."""
        stmt = (
            select(Product, Inventory)
            .join(Inventory, (Inventory.product_id == Product.id) & (Inventory.store_id == store_id))
            .join(Category, Category.id == Product.category_id)
        )
        if section:
            stmt = stmt.where(Category.section_id == section)
        if category:
            stmt = stmt.where(Category.id == category)
        if not section and not category:
            raise ApiError(400, "section_or_category_required")
        types = [FoodType(t) for t in food_types if t in FOOD_TYPES]
        if types:
            stmt = stmt.where(Product.food_type.in_(types))
        stmt = with_diet(stmt, tags)
        rows = list((await db.execute(stmt.order_by(Category.sort_order, Product.name).limit(300))).all())
        return await self._wire(db, store_id, rows)

    async def _wire(self, db: AsyncSession, store_id: str, rows: list[Any]) -> list[dict[str, Any]]:
        prices = await current_prices(db, store_id, [p.id for p, _ in rows])
        cat_ids = {p.category_id for p, _ in rows if p.category_id}
        sections = (
            dict(
                (
                    await db.execute(
                        select(Category.id, Section.name)
                        .join(Section, Section.id == Category.section_id)
                        .where(Category.id.in_(cat_ids))
                    )
                ).all()
            )
            if cat_ids
            else {}
        )
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
                    "categoryId": product.category_id,
                    "section": sections.get(product.category_id or ""),
                    "foodType": product.food_type.value if product.food_type else None,
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
        return results

    async def label_product(
        self, db: AsyncSession, product_id: str, user_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        """A manager moves a product to another category or corrects its food label from the pack."""
        product = await db.get(Product, product_id)
        if product is None:
            raise ApiError(404, "product_not_found")
        before = {
            "categoryId": product.category_id,
            "foodType": product.food_type.value if product.food_type else None,
            "dietTags": list(product.diet_tags),
        }
        if "categoryId" in body:
            cat = await db.get(Category, body["categoryId"])
            if cat is None:
                raise ApiError(404, "category_not_found")
            product.category_id, product.category = cat.id, cat.name
        if "foodType" in body:
            product.food_type = FoodType(body["foodType"]) if body["foodType"] else None
        if "dietTags" in body:
            product.diet_tags = sorted({t for t in body["dietTags"] if t in DIET_TAGS})
        db.add(
            AuditLog(
                actor_id=user_id,
                action="product.labelled",
                target=product.id,
                details={"before": before, "after": {k: body[k] for k in body}},
            )
        )
        await db.commit()
        return {
            "productId": product.id,
            "name": product.name,
            "category": product.category,
            "categoryId": product.category_id,
            "foodType": product.food_type.value if product.food_type else None,
            "dietTags": list(product.diet_tags),
        }

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
        view = HelpView(req, name, await self._user_name(db, req.handled_by) if req.handled_by else None)
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
        ids = {r.user_id for r in rows} | {r.handled_by for r in rows if r.handled_by}
        names = {i: await self._user_name(db, i) for i in ids}
        return [
            HelpView(r, names[r.user_id], names[r.handled_by] if r.handled_by else None).wire() for r in rows
        ]

    async def my_help(self, db: AsyncSession, store_id: str, user_id: str) -> dict[str, Any] | None:
        req = await db.scalar(
            select(HelpRequest)
            .where(HelpRequest.store_id == store_id, HelpRequest.user_id == user_id)
            .order_by(HelpRequest.created_at.desc())
            .limit(1)
        )
        if not req:
            return None
        return HelpView(
            req, None, await self._user_name(db, req.handled_by) if req.handled_by else None
        ).wire()

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
