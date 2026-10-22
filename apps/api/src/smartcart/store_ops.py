"""The store side's daily work: reservations for pickup, staff tasks and shelf stock corrections.

A reservation is an unpaid hold (the shopper pays at checkout as usual): its items count in
inventory.reserved so other shoppers see them as taken, a pick task goes to the floor, staff park
the picked items in a cart, and the shopper collects by pairing that cart. One active reservation
per shopper; a no-show expires an hour after the slot and its stock is released.
"""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .cart_service import CartService
from .errors import ApiError
from .models import (
    Barcode,
    Cart,
    Inventory,
    Product,
    Reservation,
    ReservationItem,
    ReservationStatus,
    Staff,
    StaffStatus,
    StaffTask,
    StockCorrection,
    StockMovement,
    StockReason,
    Store,
    TaskStatus,
    TaskType,
    User,
    utcnow,
)
from .pricing import current_prices
from .schemas import event, store_room

Publish = Callable[[dict[str, Any], list[str]], Awaitable[None]]

SLOT_MINUTES = 30
LEAD_MINUTES = 30  # time for the floor to pick before the slot starts
OPEN_HOUR, CLOSE_HOUR = 8, 22  # store hours, local time
EXPIRE_AFTER = timedelta(hours=1)  # a no-show is released this long after the slot ends
ACTIVE = (ReservationStatus.reserved, ReservationStatus.picked)
_RELEASE = text(
    "UPDATE inventory SET reserved = GREATEST(reserved - :q, 0) WHERE store_id = :s AND product_id = :p"
)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() + "Z" if dt else None


def _naive_utc(dt: datetime) -> datetime:
    return dt.astimezone(UTC).replace(tzinfo=None) if dt.tzinfo else dt


def pickup_slots(now: datetime, tz: str, count: int = 12) -> list[dict[str, str]]:
    """The next pickup slots: half-hour windows in store hours, starting at least LEAD_MINUTES out."""
    zone = ZoneInfo(tz)
    local = now.replace(tzinfo=UTC).astimezone(zone) + timedelta(minutes=LEAD_MINUTES)
    start = local.replace(second=0, microsecond=0)
    start += timedelta(minutes=(-start.minute) % SLOT_MINUTES)
    slots: list[dict[str, str]] = []
    while len(slots) < count:
        if start.hour < OPEN_HOUR:
            start = start.replace(hour=OPEN_HOUR, minute=0)
        if start.hour >= CLOSE_HOUR or (start + timedelta(minutes=SLOT_MINUTES)).hour > CLOSE_HOUR:
            start = (start + timedelta(days=1)).replace(hour=OPEN_HOUR, minute=0)
            continue
        end = start + timedelta(minutes=SLOT_MINUTES)
        slots.append(
            {
                "start": start.astimezone(UTC).isoformat().replace("+00:00", "Z"),
                "end": end.astimezone(UTC).isoformat().replace("+00:00", "Z"),
                "label": f"{start:%a} {start:%H:%M}–{end:%H:%M}",
            }
        )
        start = end
    return slots


class StoreOps:
    def __init__(self, carts: CartService, publish: Publish) -> None:
        self.carts = carts
        self.publish = publish

    # ---- reservations: shopper ------------------------------------------------------------------

    async def slots(self, db: AsyncSession, store_id: str) -> list[dict[str, str]]:
        store = await db.get(Store, store_id)
        if store is None:
            raise ApiError(404, "store_not_found")
        return pickup_slots(utcnow(), store.timezone)

    async def reserve(
        self, db: AsyncSession, store_id: str, user_id: str, items: list[dict[str, Any]], slot_start: datetime
    ) -> dict[str, Any]:
        store = await db.get(Store, store_id)
        if store is None:
            raise ApiError(404, "store_not_found")
        start = _naive_utc(slot_start)
        offered = {s["start"] for s in pickup_slots(utcnow(), store.timezone, 96)}
        if start.isoformat() + "Z" not in offered:
            raise ApiError(400, "invalid_slot")
        wanted: dict[str, int] = {}
        for it in items:
            wanted[it["productId"]] = wanted.get(it["productId"], 0) + int(it["qty"])

        # Lock the stock rows, check every item, then hold them, so two shoppers can't take the last pack.
        rows = {
            r.product_id: r
            for r in await db.scalars(
                select(Inventory)
                .where(Inventory.store_id == store_id, Inventory.product_id.in_(list(wanted)))
                .with_for_update()
            )
        }
        for product_id, qty in wanted.items():
            row = rows.get(product_id)
            if row is None:
                raise ApiError(404, "product_not_found", productId=product_id)
            if row.on_hand - row.reserved < qty:
                raise ApiError(
                    409,
                    "not_enough_stock",
                    productId=product_id,
                    available=max(row.on_hand - row.reserved, 0),
                )
        res = Reservation(
            user_id=user_id,
            store_id=store_id,
            slot_start=start,
            slot_end=start + timedelta(minutes=SLOT_MINUTES),
            items=[ReservationItem(product_id=p, qty=q) for p, q in wanted.items()],
        )
        try:
            async with db.begin_nested():
                db.add(res)
        except IntegrityError as err:
            await db.rollback()
            raise ApiError(409, "reservation_exists") from err
        for product_id, qty in wanted.items():
            rows[product_id].reserved += qty
        user = await db.get(User, user_id)
        who = (user.name if user else None) or "a shopper"
        db.add(
            StaffTask(
                store_id=store_id,
                type=TaskType.pick,
                title=f"Pick reservation for {who} ({sum(wanted.values())} items)",
                ref_id=res.id,
                due_at=res.slot_start,
            )
        )
        await db.commit()
        wire = await self.wire(db, res)
        await self._announce("reservation.created", wire)
        await self._stock_changed(db, store_id, list(wanted))
        return wire

    async def mine(self, db: AsyncSession, store_id: str, user_id: str) -> dict[str, Any] | None:
        res = await db.scalar(
            select(Reservation)
            .where(
                Reservation.store_id == store_id,
                Reservation.user_id == user_id,
                Reservation.created_at >= utcnow() - timedelta(days=2),
            )
            .order_by(Reservation.created_at.desc())
            .limit(1)
        )
        return await self.wire(db, res) if res else None

    async def cancel(
        self, db: AsyncSession, store_id: str, reservation_id: str, user_id: str
    ) -> dict[str, Any]:
        res = await self._owned(db, store_id, reservation_id, user_id)
        await self._close(db, res, ReservationStatus.cancelled)
        await db.commit()
        wire = await self.wire(db, res)
        await self._announce("reservation.updated", wire)
        await self._stock_changed(db, store_id, [i.product_id for i in res.items])
        return wire

    async def collect(
        self, db: AsyncSession, store_id: str, reservation_id: str, user_id: str
    ) -> dict[str, Any]:
        """The shopper takes the cart staff parked: it pairs to them with the picked items already in."""
        res = await self._owned(db, store_id, reservation_id, user_id)
        if res.status != ReservationStatus.picked or not res.cart_id:
            raise ApiError(409, "reservation_not_ready")
        snapshot = await self.carts.pair(db, user_id, res.cart_id, store_id, reservation_id=res.id)
        session = await self.carts.owned_session(db, snapshot.session_id, user_id)
        # The hold moves from the reservation to the cart: release it, then add each item to the cart.
        for item in res.items:
            await db.execute(
                _RELEASE,
                {"q": item.qty, "s": store_id, "p": item.product_id},
            )
        res.status, res.closed_at = ReservationStatus.collected, utcnow()
        await db.commit()
        for item in res.items:
            barcode = await db.scalar(
                select(Barcode.code).where(Barcode.product_id == item.product_id).limit(1)
            )
            if barcode and (item.picked_qty or item.qty) > 0:
                await self.carts.add_item(
                    db,
                    session,
                    barcode,
                    item.picked_qty or item.qty,
                    f"reservation:{res.id}:{item.product_id}",
                )
        wire = await self.wire(db, res)
        await self._announce("reservation.updated", wire)
        return {"reservation": wire, "cart": (await self.carts.snapshot(db, session)).wire()}

    # ---- reservations: store side --------------------------------------------------------------

    async def pick_list(self, db: AsyncSession, store_id: str) -> list[dict[str, Any]]:
        rows = await db.scalars(
            select(Reservation)
            .where(Reservation.store_id == store_id, Reservation.status.in_(ACTIVE))
            .order_by(Reservation.slot_start)
        )
        return [await self.wire(db, r) for r in rows]

    async def board(self, db: AsyncSession, store_id: str) -> list[dict[str, Any]]:
        rows = await db.scalars(
            select(Reservation)
            .where(
                Reservation.store_id == store_id,
                (Reservation.status.in_(ACTIVE)) | (Reservation.slot_start >= utcnow() - timedelta(days=1)),
            )
            .order_by(Reservation.slot_start)
            .limit(200)
        )
        return [await self.wire(db, r) for r in rows]

    async def picked(
        self, db: AsyncSession, store_id: str, reservation_id: str, staff_user_id: str, cart_code: str
    ) -> dict[str, Any]:
        res = await db.get(Reservation, reservation_id, with_for_update=True)
        if res is None or res.store_id != store_id:
            raise ApiError(404, "reservation_not_found")
        if res.status != ReservationStatus.reserved:
            raise ApiError(409, "reservation_not_open")
        code = cart_code.strip().upper()
        cart = await db.get(Cart, code)
        if cart is None or cart.store_id != store_id:
            raise ApiError(404, "cart_not_found")
        if await self.carts.cart_busy(db, code):
            raise ApiError(409, "cart_in_use")
        res.status, res.cart_id, res.picked_by, res.picked_at = (
            ReservationStatus.picked,
            code,
            staff_user_id,
            utcnow(),
        )
        for item in res.items:
            item.picked_qty = item.qty
        await self._finish_tasks(db, res.id, staff_user_id)
        await db.commit()
        wire = await self.wire(db, res)
        await self._announce("reservation.updated", wire)
        return wire

    async def expire_due(self, maker: async_sessionmaker[AsyncSession]) -> int:
        async with maker() as db:
            due = list(
                await db.scalars(
                    select(Reservation).where(
                        Reservation.status.in_(ACTIVE), Reservation.slot_end < utcnow() - EXPIRE_AFTER
                    )
                )
            )
            for res in due:
                await self._close(db, res, ReservationStatus.expired)
            await db.commit()
            for res in due:
                await self._announce("reservation.updated", await self.wire(db, res))
                await self._stock_changed(db, res.store_id, [i.product_id for i in res.items])
            return len(due)

    async def wire(self, db: AsyncSession, res: Reservation) -> dict[str, Any]:
        ids = [i.product_id for i in res.items]
        products = {p.id: p for p in await db.scalars(select(Product).where(Product.id.in_(ids)))}
        stock = {
            r.product_id: r
            for r in await db.scalars(
                select(Inventory).where(Inventory.store_id == res.store_id, Inventory.product_id.in_(ids))
            )
        }
        prices = await current_prices(db, res.store_id, ids)
        items: list[dict[str, Any]] = []
        for i in res.items:
            inv = stock.get(i.product_id)
            price = prices.get(i.product_id)
            items.append(
                {
                    "productId": i.product_id,
                    "name": products[i.product_id].name if i.product_id in products else i.product_id,
                    "qty": i.qty,
                    "pickedQty": i.picked_qty,
                    "aisle": inv.aisle if inv else None,
                    "shelf": inv.shelf if inv else None,
                    "pricePaise": price.price_paise if price else None,
                }
            )
        items.sort(key=lambda x: (x["aisle"] or "~", x["shelf"] or ""))
        user = await db.get(User, res.user_id)
        picker = await db.get(User, res.picked_by) if res.picked_by else None
        return {
            "id": res.id,
            "storeId": res.store_id,
            "status": res.status.value,
            "slotStart": _iso(res.slot_start),
            "slotEnd": _iso(res.slot_end),
            "cartCode": res.cart_id,
            "shopperName": user.name if user else None,
            "pickedBy": picker.name if picker else None,
            "items": items,
            "itemCount": sum(i.qty for i in res.items),
            "totalPaise": sum((x["pricePaise"] or 0) * x["qty"] for x in items),
            "createdAt": _iso(res.created_at),
            "pickedAt": _iso(res.picked_at),
            "closedAt": _iso(res.closed_at),
        }

    async def _owned(self, db: AsyncSession, store_id: str, reservation_id: str, user_id: str) -> Reservation:
        res = await db.get(Reservation, reservation_id, with_for_update=True)
        if res is None or res.store_id != store_id or res.user_id != user_id:
            raise ApiError(404, "reservation_not_found")
        if res.status not in ACTIVE:
            raise ApiError(409, "reservation_closed")
        return res

    async def _close(self, db: AsyncSession, res: Reservation, status: ReservationStatus) -> None:
        """Ends a reservation that is still holding stock: releases the hold and its pick task; if the
        items were already picked, someone has to put them back."""
        for item in res.items:
            await db.execute(
                _RELEASE,
                {"q": item.qty, "s": res.store_id, "p": item.product_id},
            )
        if res.status == ReservationStatus.picked and res.cart_id:
            db.add(
                StaffTask(
                    store_id=res.store_id,
                    type=TaskType.other,
                    title=f"Put back the items parked in cart {res.cart_id}",
                    note=f"Reservation {status.value}; return the items to their shelves and free the cart.",
                    ref_id=res.id,
                )
            )
        for task in await db.scalars(
            select(StaffTask).where(
                StaffTask.ref_id == res.id,
                StaffTask.type == TaskType.pick,
                StaffTask.status == TaskStatus.open,
            )
        ):
            task.status = TaskStatus.cancelled
        res.status, res.closed_at = status, utcnow()

    async def _finish_tasks(self, db: AsyncSession, ref_id: str, user_id: str) -> None:
        for task in await db.scalars(
            select(StaffTask).where(StaffTask.ref_id == ref_id, StaffTask.status == TaskStatus.open)
        ):
            task.status, task.done_by, task.done_at = TaskStatus.done, user_id, utcnow()

    async def _announce(self, type_: str, wire: dict[str, Any]) -> None:
        await self.publish(
            event(type_, store_id=wire["storeId"], cart_id=wire["cartCode"], source="system", data=wire),
            [store_room(wire["storeId"])],
        )

    async def _stock_changed(self, db: AsyncSession, store_id: str, product_ids: list[str]) -> None:
        for r in await db.scalars(
            select(Inventory).where(Inventory.store_id == store_id, Inventory.product_id.in_(product_ids))
        ):
            await self.publish(
                event(
                    "inventory.updated",
                    store_id=store_id,
                    cart_id=None,
                    source="system",
                    data={"productId": r.product_id, "onHand": r.on_hand, "reserved": r.reserved},
                ),
                [store_room(store_id)],
            )

    # ---- staff tasks ---------------------------------------------------------------------------

    async def raise_restock_tasks(self, db: AsyncSession, store_id: str) -> int:
        """One open restock task per product at or below its low-stock threshold."""
        low = list(
            await db.execute(
                select(Inventory, Product.name)
                .join(Product, Product.id == Inventory.product_id)
                .where(
                    Inventory.store_id == store_id,
                    Inventory.on_hand - Inventory.reserved <= Inventory.low_stock_threshold,
                )
            )
        )
        if not low:
            return 0
        open_refs = set(
            await db.scalars(
                select(StaffTask.ref_id).where(
                    StaffTask.store_id == store_id,
                    StaffTask.type == TaskType.restock,
                    StaffTask.status == TaskStatus.open,
                )
            )
        )
        made = 0
        for inv, name in low:
            if inv.product_id in open_refs:
                continue
            where = f"Aisle {inv.aisle}, shelf {inv.shelf}. " if inv.aisle else ""
            left = max(inv.on_hand - inv.reserved, 0)
            db.add(
                StaffTask(
                    store_id=store_id,
                    type=TaskType.restock,
                    title=f"Restock {name}",
                    note=f"{where}{left} left, threshold {inv.low_stock_threshold}.",
                    ref_id=inv.product_id,
                )
            )
            made += 1
        if made:
            await db.commit()
            await self._task_event(store_id, None)
        return made

    async def tasks(
        self, db: AsyncSession, store_id: str, *, staff_id: str | None = None
    ) -> list[dict[str, Any]]:
        """Open tasks plus today's finished ones. With staff_id: the open ones for that person
        (assigned to them, or to nobody)."""
        await self.raise_restock_tasks(db, store_id)
        stmt = select(StaffTask).where(StaffTask.store_id == store_id)
        if staff_id:
            stmt = stmt.where(
                StaffTask.status == TaskStatus.open,
                (StaffTask.assigned_to == staff_id) | (StaffTask.assigned_to.is_(None)),
            )
        else:
            stmt = stmt.where(
                (StaffTask.status == TaskStatus.open) | (StaffTask.done_at >= utcnow() - timedelta(hours=24))
            )
        rows = list(
            await db.scalars(
                stmt.order_by(StaffTask.status, StaffTask.due_at.nulls_last(), StaffTask.created_at)
            )
        )
        staff_ids = {r.assigned_to for r in rows if r.assigned_to}
        staff = (
            {s.id: s for s in await db.scalars(select(Staff).where(Staff.id.in_(staff_ids)))}
            if staff_ids
            else {}
        )
        done_ids = {r.done_by for r in rows if r.done_by}
        users = (
            {u.id: u for u in await db.scalars(select(User).where(User.id.in_(done_ids)))} if done_ids else {}
        )
        return [
            {
                "id": r.id,
                "type": r.type.value,
                "title": r.title,
                "note": r.note,
                "refId": r.ref_id,
                "status": r.status.value,
                "assignedTo": r.assigned_to,
                "assignedName": staff[r.assigned_to].full_name if r.assigned_to in staff else None,
                "dueAt": _iso(r.due_at),
                "createdAt": _iso(r.created_at),
                "doneAt": _iso(r.done_at),
                "doneBy": users[r.done_by].name if r.done_by in users else None,
            }
            for r in rows
        ]

    async def create_task(self, db: AsyncSession, store_id: str, user_id: str, body: dict[str, Any]) -> str:
        if body.get("productId") and not await db.get(Inventory, (store_id, body["productId"])):
            raise ApiError(404, "product_not_found")
        if body.get("assignedTo"):
            await self._assignable(db, store_id, body["assignedTo"])
        task = StaffTask(
            store_id=store_id,
            type=TaskType(body["type"]),
            title=body["title"].strip(),
            note=(body.get("note") or "").strip() or None,
            ref_id=body.get("productId"),
            assigned_to=body.get("assignedTo"),
            created_by=user_id,
        )
        db.add(task)
        await db.commit()
        await self._task_event(store_id, task.id)
        return task.id

    async def assign_task(self, db: AsyncSession, store_id: str, task_id: str, staff_id: str | None) -> None:
        task = await self._task(db, store_id, task_id)
        if staff_id:
            await self._assignable(db, store_id, staff_id)
        task.assigned_to = staff_id
        await db.commit()
        await self._task_event(store_id, task.id)

    async def finish_task(
        self, db: AsyncSession, store_id: str, task_id: str, user_id: str, restocked: int | None
    ) -> None:
        task = await self._task(db, store_id, task_id)
        if task.type == TaskType.pick:
            raise ApiError(409, "use_pick_list")
        if task.type == TaskType.restock and restocked and task.ref_id:
            inv = await db.get(Inventory, (store_id, task.ref_id), with_for_update=True)
            if inv:
                inv.on_hand += restocked
                db.add(
                    StockMovement(
                        store_id=store_id,
                        product_id=task.ref_id,
                        delta=restocked,
                        reason=StockReason.restock,
                        ref_id=task.id,
                    )
                )
        task.status, task.done_by, task.done_at = TaskStatus.done, user_id, utcnow()
        await db.commit()
        await self._task_event(store_id, task.id)
        if task.type == TaskType.restock and restocked and task.ref_id:
            await self._stock_changed(db, store_id, [task.ref_id])

    async def _task(self, db: AsyncSession, store_id: str, task_id: str) -> StaffTask:
        task = await db.get(StaffTask, task_id)
        if task is None or task.store_id != store_id:
            raise ApiError(404, "task_not_found")
        if task.status != TaskStatus.open:
            raise ApiError(409, "task_closed")
        return task

    async def _assignable(self, db: AsyncSession, store_id: str, staff_id: str) -> None:
        staff = await db.get(Staff, staff_id)
        if staff is None or staff.store_id != store_id or staff.status != StaffStatus.active:
            raise ApiError(404, "staff_not_found")

    async def _task_event(self, store_id: str, task_id: str | None) -> None:
        await self.publish(
            event("task.updated", store_id=store_id, cart_id=None, source="system", data={"taskId": task_id}),
            [store_room(store_id)],
        )

    # ---- shelf stock -----------------------------------------------------------------------------

    async def stock_for(self, db: AsyncSession, store_id: str, barcode: str) -> dict[str, Any]:
        product_id = await db.scalar(select(Barcode.product_id).where(Barcode.code == barcode.strip()))
        inv = await db.get(Inventory, (store_id, product_id)) if product_id else None
        if inv is None:
            raise ApiError(404, "product_not_found")
        product = await db.get(Product, inv.product_id)
        assert product
        return {
            "productId": inv.product_id,
            "barcode": barcode.strip(),
            "name": product.name,
            "onHand": inv.on_hand,
            "reserved": inv.reserved,
            "available": inv.on_hand - inv.reserved,
            "lowStockThreshold": inv.low_stock_threshold,
            "aisle": inv.aisle,
            "shelf": inv.shelf,
        }

    async def correct_stock(
        self, db: AsyncSession, store_id: str, user_id: str, barcode: str, counted: int, reason: str
    ) -> dict[str, Any]:
        """A floor count replaces the system's stock on hand; the difference is kept as a correction."""
        current = await self.stock_for(db, store_id, barcode)
        inv = await db.get(Inventory, (store_id, current["productId"]), with_for_update=True)
        assert inv
        delta = counted - inv.on_hand
        db.add(
            StockCorrection(
                store_id=store_id,
                product_id=inv.product_id,
                system_qty=inv.on_hand,
                counted_qty=counted,
                reason=reason.strip(),
                staff_user_id=user_id,
            )
        )
        if delta:
            db.add(
                StockMovement(
                    store_id=store_id, product_id=inv.product_id, delta=delta, reason=StockReason.adjust
                )
            )
        inv.on_hand = counted
        await self._finish_stock_checks(db, store_id, inv.product_id, user_id)
        await db.commit()
        await self._stock_changed(db, store_id, [inv.product_id])
        return {**(await self.stock_for(db, store_id, barcode)), "delta": delta}

    async def _finish_stock_checks(
        self, db: AsyncSession, store_id: str, product_id: str, user_id: str
    ) -> None:
        for task in await db.scalars(
            select(StaffTask).where(
                StaffTask.store_id == store_id,
                StaffTask.ref_id == product_id,
                StaffTask.type == TaskType.stock_check,
                StaffTask.status == TaskStatus.open,
            )
        ):
            task.status, task.done_by, task.done_at = TaskStatus.done, user_id, utcnow()

    async def corrections(self, db: AsyncSession, store_id: str, days: int) -> list[dict[str, Any]]:
        rows = await db.execute(
            select(StockCorrection, Product.name, User.name.label("staff_name"))
            .join(Product, Product.id == StockCorrection.product_id)
            .outerjoin(User, User.id == StockCorrection.staff_user_id)
            .where(
                StockCorrection.store_id == store_id,
                StockCorrection.at >= utcnow() - timedelta(days=max(1, min(days, 90))),
            )
            .order_by(StockCorrection.at.desc())
            .limit(200)
        )
        return [
            {
                "id": c.id,
                "productId": c.product_id,
                "name": name,
                "systemQty": c.system_qty,
                "countedQty": c.counted_qty,
                "delta": c.counted_qty - c.system_qty,
                "reason": c.reason,
                "staffName": staff_name,
                "at": _iso(c.at),
            }
            for c, name, staff_name in rows
        ]
