"""Carts, cart sessions and the live cart.

Every change is appended to cart_events (the durable record) and then applied to a Redis hash
productId -> qty (the fast projection). If Redis loses a cart it is rebuilt by replaying
cart_events. Retries carrying the same requestId are applied once, enforced by the unique
cart_events.request_id column.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Literal

from redis.asyncio import Redis
from redis.typing import EncodableT, FieldT
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from . import money
from .errors import ApiError
from .models import (
    Barcode,
    Cart,
    CartEvent,
    CartSession,
    CartSessionStatus,
    CartStatus,
    EventSource,
    Product,
    User,
    utcnow,
)
from .pricing import current_prices
from .schemas import CartLine, CartSnapshot, CartTotals, LineChange, cart_room, event, store_room

LIVE_TTL_SECONDS = 4 * 60 * 60
OPEN = (CartSessionStatus.active, CartSessionStatus.checking_out)

Publish = Callable[[dict[str, Any], list[str]], Awaitable[None]]


def items_key(session_id: str) -> str:
    return f"cart:{session_id}:items"


@dataclass(frozen=True)
class Stock:
    on_hand: int
    reserved: int
    threshold: int


_RESERVE = text(
    """UPDATE inventory SET reserved = GREATEST(reserved + :delta, 0), updated_at = now()
       WHERE store_id = :store_id AND product_id = :product_id
       RETURNING on_hand, reserved, low_stock_threshold"""
)


class CartService:
    def __init__(self, redis: Redis, publish: Publish) -> None:
        self.redis = redis
        self.publish = publish

    # --- sessions ---

    async def pair(
        self,
        db: AsyncSession,
        user_id: str,
        cart_code: str,
        store_id: str,
        source: EventSource = EventSource.phone,
    ) -> CartSnapshot:
        """Opens a session on a physical cart. Re-pairing the same cart returns the same session."""
        cart = await db.get(Cart, cart_code)
        if cart is None or cart.store_id != store_id:
            raise ApiError(404, "cart_not_found")
        if cart.status == CartStatus.maintenance:
            raise ApiError(409, "cart_in_maintenance")

        mine = await db.scalar(
            select(CartSession).where(CartSession.user_id == user_id, CartSession.status.in_(OPEN))
        )
        if mine is not None:
            if mine.cart_id == cart_code:
                return await self.snapshot(db, mine)
            raise ApiError(409, "already_shopping", sessionId=mine.id, cartCode=mine.cart_id)

        session = CartSession(cart_id=cart_code, user_id=user_id)
        try:
            # The partial unique index cart_sessions_one_open_per_cart rejects a concurrent pairing here.
            async with db.begin_nested():
                db.add(session)
        except IntegrityError as err:
            await db.rollback()
            raise ApiError(409, "cart_in_use") from err
        cart.status = CartStatus.in_use
        db.add(CartEvent(session_id=session.id, type="session.started", source=source))
        await db.commit()

        await self.publish(
            event(
                "cart.session_started",
                store_id=store_id,
                cart_id=cart_code,
                source=source.value,
                data={"sessionId": session.id, "cartCode": cart_code, "userId": user_id},
            ),
            [store_room(store_id)],
        )
        return await self.snapshot(db, session)

    async def owned_session(self, db: AsyncSession, session_id: str, user_id: str) -> CartSession:
        """The session if this user owns it; 404 otherwise (never reveals other people's carts)."""
        session = await db.get(CartSession, session_id)
        if session is None or session.user_id != user_id:
            raise ApiError(404, "session_not_found")
        return session

    async def snapshot(self, db: AsyncSession, session: CartSession) -> CartSnapshot:
        quantities = await self._quantities(db, session)
        lines = await self._lines(db, session.cart.store_id, quantities)
        return CartSnapshot(
            session_id=session.id,
            cart_code=session.cart_id,
            store_id=session.cart.store_id,
            status=session.status.value,
            lines=lines,
            totals=_totals(lines),
            updated_at=utcnow().isoformat() + "Z",
        )

    async def add_item(
        self,
        db: AsyncSession,
        session: CartSession,
        barcode: str,
        qty: int,
        request_id: str,
        source: EventSource = EventSource.phone,
    ) -> LineChange:
        _assert_active(session)
        store_id = session.cart.store_id
        product_id = await db.scalar(select(Barcode.product_id).where(Barcode.code == barcode))
        if product_id is None:
            raise ApiError(404, "product_not_found")

        try:
            async with db.begin_nested():
                db.add(
                    CartEvent(
                        session_id=session.id,
                        type="item.added",
                        product_id=product_id,
                        qty=qty,
                        source=source,
                        request_id=request_id,
                    )
                )
        except IntegrityError:
            # Same requestId seen before: the add already happened, so report the current state.
            return await self._line_change(db, session, product_id)
        # Soft reservation: stock is deducted for real only when the order is paid.
        stock = await self._reserve(db, store_id, product_id, qty)
        await db.commit()

        await self._apply_delta(db, session, product_id, qty)
        change = await self._line_change(db, session, product_id)
        if change.line is None:
            raise RuntimeError("added line missing from cart")

        await self.publish(
            event(
                "cart.item_added",
                store_id=store_id,
                cart_id=session.cart_id,
                source=source.value,
                data={"sessionId": session.id, "line": change.line.wire(), "totals": change.totals.wire()},
            ),
            [cart_room(session.id), store_room(store_id)],
        )
        if stock:
            await self._publish_stock(store_id, product_id, stock, added=qty, name=change.line.name)
        return change

    async def remove_item(
        self,
        db: AsyncSession,
        session: CartSession,
        product_id: str,
        qty: int | Literal["all"],
        request_id: str,
        source: EventSource = EventSource.phone,
    ) -> LineChange:
        _assert_active(session)
        store_id = session.cart.store_id
        current = (await self._quantities(db, session)).get(product_id, 0)
        if current == 0:
            raise ApiError(404, "item_not_in_cart")
        n = current if qty == "all" else min(qty, current)

        try:
            async with db.begin_nested():
                db.add(
                    CartEvent(
                        session_id=session.id,
                        type="item.removed",
                        product_id=product_id,
                        qty=n,
                        source=source,
                        request_id=request_id,
                    )
                )
        except IntegrityError:
            return await self._line_change(db, session, product_id)
        stock = await self._reserve(db, store_id, product_id, -n)
        await db.commit()

        await self._apply_delta(db, session, product_id, -n)
        change = await self._line_change(db, session, product_id)
        await self.publish(
            event(
                "cart.item_removed",
                store_id=store_id,
                cart_id=session.cart_id,
                source=source.value,
                data={
                    "sessionId": session.id,
                    "productId": product_id,
                    "line": change.line.wire() if change.line else None,
                    "totals": change.totals.wire(),
                },
            ),
            [cart_room(session.id), store_room(store_id)],
        )
        if stock:
            await self._publish_stock(store_id, product_id, stock, added=0, name=None)
        return change

    async def end_session(
        self,
        db: AsyncSession,
        session: CartSession,
        reason: Literal["cancelled", "abandoned"],
        source: EventSource = EventSource.phone,
    ) -> None:
        """Ends an open session without an order: releases reservations and frees the cart."""
        if session.status != CartSessionStatus.active:
            raise ApiError(409, "session_not_active", status=session.status.value)
        store_id = session.cart.store_id
        quantities = await self._quantities(db, session)

        for product_id, qty in quantities.items():
            await self._reserve(db, store_id, product_id, -qty)
        db.add(CartEvent(session_id=session.id, type=f"session.{reason}", source=source))
        session.status = CartSessionStatus.abandoned
        session.ended_at = utcnow()
        await db.execute(update(Cart).where(Cart.id == session.cart_id).values(status=CartStatus.available))
        await db.commit()
        await self.redis.delete(items_key(session.id))

        await self.publish(
            event(
                "cart.session_ended",
                store_id=store_id,
                cart_id=session.cart_id,
                source=source.value,
                data={"sessionId": session.id, "reason": reason},
            ),
            [cart_room(session.id), store_room(store_id)],
        )

    async def sweep_idle(
        self, maker: async_sessionmaker[AsyncSession], idle_minutes: int, now: Any = None
    ) -> int:
        """Abandons active sessions with no activity for idle_minutes. Returns how many it ended."""
        cutoff = (now or utcnow()) - timedelta(minutes=idle_minutes)
        async with maker() as db:
            ids = (
                await db.scalars(
                    text(
                        """SELECT s.id FROM cart_sessions s
                           WHERE s.status = 'active'
                             AND COALESCE((SELECT max(e.at) FROM cart_events e WHERE e.session_id = s.id),
                                          s.started_at) < :cutoff"""
                    ),
                    {"cutoff": cutoff},
                )
            ).all()
        for session_id in ids:
            async with maker() as db:
                session = await db.get(CartSession, session_id)
                if session is not None and session.status == CartSessionStatus.active:
                    await self.end_session(db, session, "abandoned", EventSource.system)
        return len(ids)

    async def active_in_store(self, db: AsyncSession, store_id: str) -> list[dict[str, Any]]:
        """Open sessions in a store, for the dashboard."""
        rows = (
            await db.execute(
                select(CartSession, User.name)
                .join(Cart, Cart.id == CartSession.cart_id)
                .join(User, User.id == CartSession.user_id)
                .where(CartSession.status.in_(OPEN), Cart.store_id == store_id)
                .order_by(CartSession.started_at)
            )
        ).all()
        out = []
        for session, shopper_name in rows:
            snap = await self.snapshot(db, session)
            out.append(
                {
                    "sessionId": session.id,
                    "cartCode": session.cart_id,
                    "shopperName": shopper_name,
                    "status": session.status.value,
                    "startedAt": session.started_at.isoformat() + "Z",
                    "totals": snap.totals.wire(),
                }
            )
        return out

    # --- internals ---

    async def _quantities(self, db: AsyncSession, session: CartSession) -> dict[str, int]:
        """productId -> qty from Redis, rebuilt from cart_events if the hash is missing."""
        key = items_key(session.id)
        if await self.redis.exists(key):
            raw: dict[bytes | str, bytes | str] = await self.redis.hgetall(key)
            return {_s(k): int(v) for k, v in raw.items() if _s(k) != "_" and int(v) > 0}
        rebuilt = await self._replay(db, session.id)
        if session.status in OPEN:
            # A marker field keeps an empty cart's hash in existence so we don't replay on every read.
            async with self.redis.pipeline(transaction=True) as pipe:
                pipe.delete(key)
                fields: dict[FieldT, EncodableT] = {"_": 0}
                fields.update(rebuilt)
                pipe.hset(key, mapping=fields)
                pipe.expire(key, LIVE_TTL_SECONDS)
                await pipe.execute()
        return rebuilt

    async def _replay(self, db: AsyncSession, session_id: str) -> dict[str, int]:
        events = await db.execute(
            select(CartEvent.type, CartEvent.product_id, CartEvent.qty)
            .where(CartEvent.session_id == session_id, CartEvent.type.in_(["item.added", "item.removed"]))
            .order_by(CartEvent.at)
        )
        q: dict[str, int] = {}
        for type_, product_id, qty in events:
            if not product_id or not qty:
                continue
            n = q.get(product_id, 0) + (qty if type_ == "item.added" else -qty)
            if n > 0:
                q[product_id] = n
            else:
                q.pop(product_id, None)
        return q

    async def _apply_delta(self, db: AsyncSession, session: CartSession, product_id: str, delta: int) -> None:
        key = items_key(session.id)
        if not await self.redis.exists(key):
            # Rebuilding replays cart_events, which already include this change: don't apply it twice.
            await self._quantities(db, session)
            return
        n = await self.redis.hincrby(key, product_id, delta)
        if n <= 0:
            await self.redis.hdel(key, product_id)
        await self.redis.expire(key, LIVE_TTL_SECONDS)

    async def _line_change(self, db: AsyncSession, session: CartSession, product_id: str) -> LineChange:
        lines = await self._lines(db, session.cart.store_id, await self._quantities(db, session))
        line = next((l for l in lines if l.product_id == product_id), None)  # noqa: E741
        return LineChange(line=line, totals=_totals(lines))

    async def _lines(self, db: AsyncSession, store_id: str, quantities: dict[str, int]) -> list[CartLine]:
        ids = [pid for pid, q in quantities.items() if q > 0]
        if not ids:
            return []
        products = {p.id: p for p in await db.scalars(select(Product).where(Product.id.in_(ids)))}
        prices = await current_prices(db, store_id, ids)
        lines = []
        for pid in ids:
            p, price = products.get(pid), prices.get(pid)
            if p is None or price is None:
                continue
            priced = money.PricedLine(quantities[pid], price.price_paise, p.gst_rate_bp)
            total, tax = money.line_amounts(priced)
            lines.append(
                CartLine(
                    product_id=pid,
                    name=p.name,
                    brand=p.brand,
                    image_url=p.image_url,
                    qty=priced.qty,
                    unit_price_paise=priced.unit_price_paise,
                    gst_rate_bp=priced.gst_rate_bp,
                    line_total_paise=total,
                    line_tax_paise=tax,
                )
            )
        return sorted(lines, key=lambda l: l.name)  # noqa: E741

    async def _reserve(self, db: AsyncSession, store_id: str, product_id: str, delta: int) -> Stock | None:
        row = (
            await db.execute(_RESERVE, {"delta": delta, "store_id": store_id, "product_id": product_id})
        ).one_or_none()
        return Stock(row.on_hand, row.reserved, row.low_stock_threshold) if row else None

    async def _publish_stock(
        self, store_id: str, product_id: str, stock: Stock, added: int, name: str | None
    ) -> None:
        await self.publish(
            event(
                "inventory.updated",
                store_id=store_id,
                cart_id=None,
                source="system",
                data={"productId": product_id, "onHand": stock.on_hand, "reserved": stock.reserved},
            ),
            [store_room(store_id)],
        )
        available = stock.on_hand - stock.reserved
        # Alert once, when an add takes available stock across the threshold.
        if added > 0 and name and available <= stock.threshold < available + added:
            await self.publish(
                event(
                    "inventory.low_stock",
                    store_id=store_id,
                    cart_id=None,
                    source="system",
                    data={
                        "productId": product_id,
                        "name": name,
                        "onHand": stock.on_hand,
                        "available": available,
                        "threshold": stock.threshold,
                    },
                ),
                [store_room(store_id)],
            )


def _totals(lines: list[CartLine]) -> CartTotals:
    t = money.cart_totals([money.PricedLine(l.qty, l.unit_price_paise, l.gst_rate_bp) for l in lines])  # noqa: E741
    return CartTotals(
        total_paise=t.total_paise,
        tax_paise=t.tax_paise,
        subtotal_paise=t.subtotal_paise,
        item_count=t.item_count,
    )


def _assert_active(session: CartSession) -> None:
    if session.status != CartSessionStatus.active:
        raise ApiError(409, "session_not_active", status=session.status.value)


def _s(v: bytes | str) -> str:
    return v.decode() if isinstance(v, bytes) else v
