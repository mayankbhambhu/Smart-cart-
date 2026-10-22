"""Checkout: turns an open cart into an order, collects payment, and issues the exit code.

Flow: checkout freezes the cart's prices into an order (status pending_payment) and moves the
session to checking_out, so scanning stops. The provider confirms payment (Stripe webhook, or the
fake provider's confirm call in development); only then is the order paid, the reserved stock
sold, the cart freed, and an exit code issued. "Back to cart" reopens the session and voids any
payment still in flight.
"""

import logging
import secrets
from datetime import timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from . import money
from .cart_service import CartService, Publish, items_key
from .errors import ApiError
from .models import (
    Cart,
    CartEvent,
    CartSession,
    CartSessionStatus,
    CartStatus,
    EventSource,
    Order,
    OrderItem,
    OrderStatus,
    Payment,
    PaymentStatus,
    Product,
    StockMovement,
    StockReason,
    Store,
    User,
    new_id,
    utcnow,
)
from .payments import PaymentError, PaymentProvider, PaymentUpdate
from .schemas import (
    CartLine,
    CartTotals,
    CheckoutResponse,
    ExitCheckResponse,
    GstSummaryRow,
    PaymentIntentOut,
    Receipt,
    cart_room,
    event,
    store_room,
)

log = logging.getLogger("smartcart.checkout")

# No 0/O or 1/I/L, so a code read aloud or typed at the exit is unambiguous.
EXIT_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
EXIT_CODE_LENGTH = 6

_SELL = text(
    """UPDATE inventory SET on_hand = on_hand - :qty, reserved = GREATEST(reserved - :qty, 0),
              updated_at = now()
       WHERE store_id = :store_id AND product_id = :product_id
       RETURNING on_hand, reserved"""
)


def _iso(dt: Any) -> str | None:
    return dt.isoformat() + "Z" if dt is not None else None


def exit_qr(order_id: str, code: str) -> str:
    return f"smartcart://exit?order={order_id}&code={code}"


def exit_code_from(scanned: str) -> str:
    """Accepts a typed code or the whole exit QR payload."""
    if scanned.startswith("smartcart://"):
        return parse_qs(urlparse(scanned).query).get("code", [""])[0].upper()
    return scanned.strip().upper()


class CheckoutService:
    def __init__(self, carts: CartService, provider: PaymentProvider, publish: Publish) -> None:
        self.carts = carts
        self.provider = provider
        self.publish = publish

    # --- shopper ---

    async def checkout(self, db: AsyncSession, session: CartSession) -> CheckoutResponse:
        """Starts (or resumes) paying for a cart. Safe to retry."""
        if session.status not in (CartSessionStatus.active, CartSessionStatus.checking_out):
            raise ApiError(409, "session_not_active", status=session.status.value)
        store_id = session.cart.store_id
        order = await db.scalar(select(Order).where(Order.session_id == session.id))

        if session.status == CartSessionStatus.checking_out and order is not None:
            # Resuming: the cart is frozen, so the order is still right. Hand back the open payment.
            payment = await db.scalar(
                select(Payment)
                .where(Payment.order_id == order.id, Payment.status == PaymentStatus.created)
                .order_by(Payment.created_at.desc())
            )
            if payment is not None and self.provider.name == "fake":
                return CheckoutResponse(
                    order=await self.receipt(db, order), payment=self._intent(payment.provider_order_id, None)
                )

        lines = await self.carts.lines(db, session)
        if not lines:
            raise ApiError(409, "cart_empty")
        totals = _totals(lines)
        order_id = order.id if order is not None else new_id()
        attempt = (
            await db.scalar(text("SELECT count(*) FROM payments WHERE order_id = :id"), {"id": order_id}) or 0
        )
        try:
            created = await self.provider.create(
                order_id=order_id,
                amount_paise=totals.total_paise,
                store_id=store_id,
                attempt=attempt + 1,
            )
        except PaymentError as err:
            log.warning("payment provider refused order %s: %s", order_id, err)
            raise ApiError(502, "payment_unavailable") from err

        if order is None:
            order = Order(id=order_id, session_id=session.id, user_id=session.user_id, store_id=store_id)
            db.add(order)
        else:
            # Back from "back to cart": the lines may have changed since, so re-freeze them.
            await db.execute(delete(OrderItem).where(OrderItem.order_id == order.id))
        order.status = OrderStatus.pending_payment
        order.subtotal_paise, order.tax_paise, order.total_paise = (
            totals.subtotal_paise,
            totals.tax_paise,
            totals.total_paise,
        )
        await db.flush()
        db.add_all(
            OrderItem(
                order_id=order.id,
                product_id=line.product_id,
                qty=line.qty,
                unit_price_paise=line.unit_price_paise,
                gst_rate_bp=line.gst_rate_bp,
            )
            for line in lines
        )
        db.add(
            Payment(
                order_id=order.id,
                provider=self.provider.name,
                provider_order_id=created.provider_payment_id,
            )
        )
        session.status = CartSessionStatus.checking_out
        db.add(CartEvent(session_id=session.id, type="checkout.started", source=EventSource.phone))
        await db.commit()

        await self.publish(
            event(
                "cart.checked_out",
                store_id=store_id,
                cart_id=session.cart_id,
                source="phone",
                data={"sessionId": session.id, "orderId": order.id, "totals": totals.wire()},
            ),
            [cart_room(session.id), store_room(store_id)],
        )
        return CheckoutResponse(
            order=await self.receipt(db, order),
            payment=self._intent(created.provider_payment_id, created.client_secret),
        )

    async def back_to_cart(self, db: AsyncSession, order: Order) -> None:
        """The shopper wants to change the cart: void open payments and reopen scanning."""
        if order.status != OrderStatus.pending_payment:
            raise ApiError(409, "order_not_pending", status=order.status.value)
        session = await db.get_one(CartSession, order.session_id)
        await db.execute(
            update(Payment)
            .where(Payment.order_id == order.id, Payment.status == PaymentStatus.created)
            .values(status=PaymentStatus.failed)
        )
        session.status = CartSessionStatus.active
        db.add(CartEvent(session_id=session.id, type="checkout.reopened", source=EventSource.phone))
        await db.commit()
        await self.publish(
            event(
                "cart.session_started",
                store_id=order.store_id,
                cart_id=session.cart_id,
                source="phone",
                data={"sessionId": session.id, "cartCode": session.cart_id, "userId": session.user_id},
            ),
            [store_room(order.store_id)],
        )

    # --- provider outcomes ---

    async def confirm_fake(self, db: AsyncSession, order: Order) -> Receipt:
        """Development only: pay the order's open fake payment, as a Stripe webhook would."""
        if self.provider.name != "fake":
            raise ApiError(404, "not_found")
        payment_id = await db.scalar(
            select(Payment.provider_order_id).where(
                Payment.order_id == order.id, Payment.status == PaymentStatus.created
            )
        )
        if payment_id is None:
            raise ApiError(409, "order_not_pending", status=order.status.value)
        await self.apply(db, PaymentUpdate(payment_id, "succeeded", {"fake": True}))
        await db.refresh(order)
        return await self.receipt(db, order)

    async def apply(self, db: AsyncSession, update_: PaymentUpdate) -> None:
        """Applies a verified payment outcome. Idempotent: providers redeliver webhooks."""
        payment = await db.scalar(
            select(Payment).where(Payment.provider_order_id == update_.provider_payment_id).with_for_update()
        )
        if payment is None:
            log.warning("payment update for unknown payment %s", update_.provider_payment_id)
            return
        if payment.status != PaymentStatus.created:
            if update_.status == "succeeded" and payment.status == PaymentStatus.failed:
                # Paid after the shopper went back to the cart: money taken for a voided payment.
                log.error("payment %s succeeded after it was voided; refund it", payment.provider_order_id)
            return
        payment.raw_webhook = update_.raw
        if update_.status == "failed":
            payment.status = PaymentStatus.failed
            await db.commit()
            return

        order = await db.get_one(Order, payment.order_id, with_for_update=True)
        session = await db.get_one(CartSession, order.session_id)
        payment.status = PaymentStatus.succeeded
        payment.provider_payment_id = update_.provider_payment_id
        order.status = OrderStatus.paid
        session.status = CartSessionStatus.paid
        session.ended_at = utcnow()
        await db.execute(update(Cart).where(Cart.id == session.cart_id).values(status=CartStatus.available))
        db.add(CartEvent(session_id=session.id, type="checkout.paid", source=EventSource.system))

        stock: list[tuple[str, int, int]] = []
        items = (await db.scalars(select(OrderItem).where(OrderItem.order_id == order.id))).all()
        for item in items:
            row = (
                await db.execute(
                    _SELL, {"qty": item.qty, "store_id": order.store_id, "product_id": item.product_id}
                )
            ).one_or_none()
            if row:
                stock.append((item.product_id, row.on_hand, row.reserved))
            db.add(
                StockMovement(
                    store_id=order.store_id,
                    product_id=item.product_id,
                    delta=-item.qty,
                    reason=StockReason.sale,
                    ref_id=order.id,
                )
            )
        await self._issue_exit_code(db, order)
        await self.carts.redis.delete(items_key(session.id))

        rooms = [cart_room(session.id), store_room(order.store_id)]
        await self.publish(
            event(
                "order.paid",
                store_id=order.store_id,
                cart_id=session.cart_id,
                source="system",
                data={"orderId": order.id, "sessionId": session.id, "totalPaise": order.total_paise},
            ),
            rooms,
        )
        await self.publish(
            event(
                "cart.session_ended",
                store_id=order.store_id,
                cart_id=session.cart_id,
                source="system",
                data={"sessionId": session.id, "reason": "paid"},
            ),
            rooms,
        )
        for product_id, on_hand, reserved in stock:
            await self.publish(
                event(
                    "inventory.updated",
                    store_id=order.store_id,
                    cart_id=None,
                    source="system",
                    data={"productId": product_id, "onHand": on_hand, "reserved": reserved},
                ),
                [store_room(order.store_id)],
            )

    async def _issue_exit_code(self, db: AsyncSession, order: Order) -> None:
        """Commits the paid order with a fresh, unique exit code."""
        for _ in range(5):
            order.exit_code = "".join(secrets.choice(EXIT_ALPHABET) for _ in range(EXIT_CODE_LENGTH))
            try:
                async with db.begin_nested():
                    await db.flush()
                await db.commit()
                return
            except IntegrityError:
                continue
        raise RuntimeError("could not issue a unique exit code")

    async def expire_stale(self, maker: async_sessionmaker[AsyncSession], idle_minutes: int) -> int:
        """Reopens carts left at the payment screen, so the idle sweep can release them."""
        cutoff = utcnow() - timedelta(minutes=idle_minutes)
        async with maker() as db:
            orders = (
                await db.scalars(
                    select(Order)
                    .join(CartSession, CartSession.id == Order.session_id)
                    .where(
                        CartSession.status == CartSessionStatus.checking_out,
                        Order.status == OrderStatus.pending_payment,
                        Order.created_at < cutoff,
                    )
                )
            ).all()
            for order in orders:
                await self.back_to_cart(db, order)
        return len(orders)

    # --- reading ---

    async def owned_order(self, db: AsyncSession, order_id: str, user_id: str) -> Order:
        order = await db.get(Order, order_id)
        if order is None or order.user_id != user_id:
            raise ApiError(404, "order_not_found")
        return order

    async def receipt(self, db: AsyncSession, order: Order) -> Receipt:
        rows = (
            await db.execute(
                select(OrderItem, Product)
                .join(Product, Product.id == OrderItem.product_id)
                .where(OrderItem.order_id == order.id)
                .order_by(Product.name)
            )
        ).all()
        lines = []
        for item, product in rows:
            total, tax = money.line_amounts(
                money.PricedLine(item.qty, item.unit_price_paise, item.gst_rate_bp)
            )
            lines.append(
                CartLine(
                    product_id=product.id,
                    name=product.name,
                    brand=product.brand,
                    image_url=product.image_url,
                    qty=item.qty,
                    unit_price_paise=item.unit_price_paise,
                    gst_rate_bp=item.gst_rate_bp,
                    line_total_paise=total,
                    line_tax_paise=tax,
                )
            )
        summary: dict[int, list[int]] = {}
        for line in lines:
            row = summary.setdefault(line.gst_rate_bp, [0, 0])
            row[0] += line.line_total_paise - line.line_tax_paise
            row[1] += line.line_tax_paise
        session = await db.get_one(CartSession, order.session_id)
        store = await db.get_one(Store, order.store_id)
        paid = order.status == OrderStatus.paid and order.exit_code is not None
        return Receipt(
            order_id=order.id,
            session_id=order.session_id,
            store_id=order.store_id,
            store_name=store.name,
            cart_code=session.cart_id,
            status=order.status.value,
            lines=lines,
            totals=CartTotals(
                total_paise=order.total_paise,
                tax_paise=order.tax_paise,
                subtotal_paise=order.subtotal_paise,
                item_count=sum(line.qty for line in lines),
            ),
            gst_summary=[
                GstSummaryRow(gst_rate_bp=rate, taxable_paise=t, tax_paise=x)
                for rate, (t, x) in sorted(summary.items())
            ],
            exit_code=order.exit_code if paid else None,
            exit_qr=exit_qr(order.id, order.exit_code) if paid and order.exit_code else None,
            exit_used_at=_iso(order.exit_used_at),
            created_at=_iso(order.created_at) or "",
        )

    async def my_orders(self, db: AsyncSession, user_id: str, limit: int = 20) -> list[Receipt]:
        orders = await db.scalars(
            select(Order)
            .where(Order.user_id == user_id, Order.status == OrderStatus.paid)
            .order_by(Order.created_at.desc())
            .limit(limit)
        )
        return [await self.receipt(db, o) for o in orders]

    # --- staff ---

    async def store_orders(self, db: AsyncSession, store_id: str, limit: int = 100) -> list[dict[str, Any]]:
        rows = (
            await db.execute(
                select(Order, CartSession.cart_id, User.name)
                .join(CartSession, CartSession.id == Order.session_id)
                .join(User, User.id == Order.user_id)
                .where(Order.store_id == store_id)
                .order_by(Order.created_at.desc())
                .limit(limit)
            )
        ).all()
        counted = await db.execute(
            select(OrderItem.order_id, func.sum(OrderItem.qty))
            .where(OrderItem.order_id.in_([o.id for o, _, _ in rows]))
            .group_by(OrderItem.order_id)
        )
        item_counts: dict[str, int] = {order_id: int(n) for order_id, n in counted.all()}
        return [
            {
                "orderId": o.id,
                "cartCode": cart_code,
                "shopperName": name,
                "status": o.status.value,
                "totalPaise": o.total_paise,
                "taxPaise": o.tax_paise,
                "itemCount": item_counts.get(o.id, 0),
                "exitCode": o.exit_code,
                "exitUsedAt": _iso(o.exit_used_at),
                "createdAt": _iso(o.created_at),
            }
            for o, cart_code, name in rows
        ]

    async def check_exit(self, db: AsyncSession, store_id: str, scanned: str) -> ExitCheckResponse:
        """Staff at the door: is this code a paid order from this store, and is it the first use?"""
        code = exit_code_from(scanned)
        order = await db.scalar(
            select(Order).where(Order.exit_code == code, Order.store_id == store_id).with_for_update()
        )
        if order is None:
            return ExitCheckResponse(result="not_found", order=None)
        if order.status != OrderStatus.paid:
            return ExitCheckResponse(result="not_paid", order=await self.receipt(db, order))
        if order.exit_used_at is not None:
            return ExitCheckResponse(result="already_used", order=await self.receipt(db, order))
        order.exit_used_at = utcnow()
        await db.commit()
        return ExitCheckResponse(result="ok", order=await self.receipt(db, order))

    def _intent(self, payment_id: str | None, client_secret: str | None) -> PaymentIntentOut:
        return PaymentIntentOut(
            provider=self.provider.name,
            payment_id=payment_id or "",
            client_secret=client_secret,
            publishable_key=self.provider.publishable_key,
        )


def _totals(lines: list[CartLine]) -> CartTotals:
    t = money.cart_totals([money.PricedLine(x.qty, x.unit_price_paise, x.gst_rate_bp) for x in lines])
    return CartTotals(
        total_paise=t.total_paise,
        tax_paise=t.tax_paise,
        subtotal_paise=t.subtotal_paise,
        item_count=t.item_count,
    )
