"""Anti-theft and the cart fleet (milestone 7).

Each cart's hardware reports its battery, the weight on its load cell, the aisle beacon it last
heard and any faults. The weight is compared with what the shopper scanned:

- More weight than scanned items means something went in without a scan. The shopper is nudged
  first ("scan it, or call for help"); only if it still doesn't match after ALERT_AFTER does the
  floor get an alert, with the cart's aisle.
- Less weight than scanned means a scanned item went back on the shelf. Only the shopper is told,
  since they would otherwise pay for it.
- A cart passing the exit gate without having paid raises an alert at once.

The system points; staff decide. Alerts say "check", never "theft", and a cart that matches again by
itself clears its alert. When the weight can't be checked (a product without a known weight), it
isn't: unsure means no alert. In V1 a simulator (smartcart.cart_sim) stands in for the hardware; in
V2 AWS IoT Core forwards the same readings.
"""

import hashlib
import hmac
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .cart_service import OPEN, CartService
from .errors import ApiError
from .models import (
    AuditLog,
    Cart,
    CartSession,
    CartStatus,
    CartTelemetry,
    Product,
    SecurityAlert,
    User,
    utcnow,
)
from .schemas import cart_room, event, store_room

Publish = Callable[[dict[str, Any], list[str]], Awaitable[None]]
WeightStatus = Literal["ok", "extra", "missing", "unknown"]

# A match is within TOLERANCE_G or TOLERANCE_PCT of the scanned items' weight, whichever is larger:
# load cells drift a little, and printed pack weights are approximate.
TOLERANCE_G = 120
TOLERANCE_PCT = 0.06
# How long extra weight may stay unscanned before the floor is told. Shoppers often put an item in
# and then scan it, so the shopper's own nudge comes first.
ALERT_AFTER = timedelta(seconds=45)
LOW_BATTERY_PCT = 20
OFFLINE_AFTER = timedelta(minutes=5)
OPEN_ALERT = ("open", "acknowledged")
FAULTS = ("scale_error", "scanner_error", "beacon_lost", "lid_open")


@dataclass(frozen=True)
class WeightCheck:
    status: WeightStatus
    expected_g: int | None
    diff_g: int | None


def weight_check(measured_g: int, items: list[tuple[int | None, int]]) -> WeightCheck:
    """Compares the load cell with the scanned items' (weight_g, qty). Unknown weights mean unsure."""
    if any(w is None for w, _ in items):
        return WeightCheck("unknown", None, None)
    expected = sum((w or 0) * q for w, q in items)
    diff = measured_g - expected
    tolerance = max(TOLERANCE_G, round(expected * TOLERANCE_PCT))
    status: WeightStatus = "extra" if diff > tolerance else "missing" if diff < -tolerance else "ok"
    return WeightCheck(status, expected, diff)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() + "Z" if dt else None


class CartGuard:
    def __init__(self, carts: CartService, publish: Publish, device_secret: str) -> None:
        self.carts = carts
        self.publish = publish
        self.device_secret = device_secret.encode()
        self.alert_after = ALERT_AFTER

    # ---- hardware ----------------------------------------------------------------------------

    def device_key(self, device: str) -> str:
        """The key a cart ("cart:C-0007") or exit gate ("gate:S-01:G1") signs its readings with."""
        return hmac.new(self.device_secret, device.encode(), hashlib.sha256).hexdigest()[:32]

    def check_device(self, device: str, key: str | None) -> None:
        if not key or not hmac.compare_digest(key, self.device_key(device)):
            raise ApiError(401, "bad_device_key")

    async def telemetry(self, db: AsyncSession, cart_id: str, body: dict[str, Any]) -> dict[str, Any]:
        cart = await db.get(Cart, cart_id)
        if cart is None:
            raise ApiError(404, "cart_not_found")
        now = utcnow()
        row = await db.get(CartTelemetry, cart_id)
        if row is None:
            row = CartTelemetry(cart_id=cart_id, battery_pct=0, weight_g=0)
            db.add(row)
        row.battery_pct = body["battery_pct"]
        row.weight_g = body["weight_g"]
        row.aisle = (body.get("aisle") or "").strip().upper() or None
        row.faults = [f for f in body.get("faults") or [] if f in FAULTS]
        row.seen_at = now

        session = await self._open_session(db, cart_id)
        check = WeightCheck("unknown", None, None)
        if session is not None:
            check = await self._check(db, session, row.weight_g)
        mismatch = check.status in ("extra", "missing")
        nudge: WeightStatus | None = None
        if mismatch and row.mismatch_since is None:
            row.mismatch_since, nudge = now, check.status
        elif not mismatch and row.mismatch_since is not None:
            row.mismatch_since, nudge = None, "ok" if check.status == "ok" else None

        raised: SecurityAlert | None = None
        cleared: list[SecurityAlert] = []
        overdue = row.mismatch_since is not None and now - row.mismatch_since >= self.alert_after
        if (
            session is not None
            and check.status == "extra"
            and overdue
            and not await self._open_alert(db, session.id, "unscanned_item")
        ):
            raised = SecurityAlert(
                store_id=cart.store_id,
                cart_id=cart_id,
                session_id=session.id,
                kind="unscanned_item",
                aisle=row.aisle,
                details={"expectedG": check.expected_g, "measuredG": row.weight_g, "diffG": check.diff_g},
            )
            db.add(raised)
        if session is not None and check.status == "ok":
            for alert in await db.scalars(
                select(SecurityAlert).where(
                    SecurityAlert.session_id == session.id,
                    SecurityAlert.kind == "unscanned_item",
                    SecurityAlert.status.in_(OPEN_ALERT),
                )
            ):
                alert.status, alert.closed_at = "cleared", now
                cleared.append(alert)
        await db.commit()

        if session is not None and nudge is not None:
            await self.publish(
                event(
                    "cart.weight_check",
                    store_id=cart.store_id,
                    cart_id=cart_id,
                    source="cart",
                    data={"sessionId": session.id, "status": nudge, "diffG": check.diff_g},
                ),
                [cart_room(session.id)],
            )
        if raised is not None:
            await self._announce(db, "security.alert", raised)
        for alert in cleared:
            await self._announce(db, "security.updated", alert)
        return {
            "cartId": cart_id,
            "weightCheck": check.status,
            "expectedG": check.expected_g,
            "diffG": check.diff_g,
        }

    async def gate_pass(self, db: AsyncSession, store_id: str, gate_id: str, cart_id: str) -> dict[str, Any]:
        """A cart went through the exit gate. Unpaid (still shopping or at the payment screen) alerts."""
        cart = await db.get(Cart, cart_id)
        if cart is None or cart.store_id != store_id:
            raise ApiError(404, "cart_not_found")
        session = await self._open_session(db, cart_id)
        if session is None:
            return {"result": "ok", "alertId": None}
        existing = await self._open_alert(db, session.id, "exit_unpaid")
        if existing is not None:
            return {"result": "alert", "alertId": existing.id}
        tele = await db.get(CartTelemetry, cart_id)
        alert = SecurityAlert(
            store_id=store_id,
            cart_id=cart_id,
            session_id=session.id,
            kind="exit_unpaid",
            aisle=tele.aisle if tele else None,
            details={"gateId": gate_id, "sessionStatus": session.status.value},
        )
        db.add(alert)
        await db.commit()
        await self._announce(db, "security.alert", alert)
        return {"result": "alert", "alertId": alert.id}

    # ---- staff ---------------------------------------------------------------------------------

    async def alerts(self, db: AsyncSession, store_id: str, *, open_only: bool) -> list[dict[str, Any]]:
        """Open alerts, or everything from the last day, newest first."""
        stmt = select(SecurityAlert).where(SecurityAlert.store_id == store_id)
        if open_only:
            stmt = stmt.where(SecurityAlert.status.in_(OPEN_ALERT))
        else:
            stmt = stmt.where(SecurityAlert.created_at >= utcnow() - timedelta(days=1))
        rows = list(await db.scalars(stmt.order_by(SecurityAlert.created_at.desc()).limit(100)))
        return [await self.wire(db, a) for a in rows]

    async def act(
        self, db: AsyncSession, store_id: str, alert_id: str, action: str, note: str | None, user_id: str
    ) -> dict[str, Any]:
        alert = await db.get(SecurityAlert, alert_id)
        if alert is None or alert.store_id != store_id:
            raise ApiError(404, "alert_not_found")
        if alert.status not in OPEN_ALERT:
            raise ApiError(409, "alert_closed")
        if action == "acknowledge":
            alert.status = "acknowledged"
        else:
            alert.status = "resolved" if action == "resolve" else "false_alarm"
            alert.closed_at = utcnow()
        alert.handled_by = user_id
        if note:
            alert.note = note.strip()[:200]
        db.add(
            AuditLog(
                actor_id=user_id, action=f"security_alert.{action}", target=alert.id, details={"note": note}
            )
        )
        await db.commit()
        await self._announce(db, "security.updated", alert)
        return await self.wire(db, alert)

    async def bag_check(self, db: AsyncSession, session_id: str) -> dict[str, Any] | None:
        """For the exit check: an unscanned-item alert still open on this order's cart session."""
        alert = await self._open_alert(db, session_id, "unscanned_item")
        if alert is None:
            return None
        diff = (alert.details or {}).get("diffG")
        weight = f"about {round(diff / 50) * 50} g more" if isinstance(diff, int) else "more"
        return {
            "alertId": alert.id,
            "reason": f"The cart weighed {weight} than the items scanned. Check the bag against the receipt.",
        }

    # ---- fleet ---------------------------------------------------------------------------------

    async def fleet(self, db: AsyncSession, store_id: str) -> list[dict[str, Any]]:
        """Every cart: in use by whom, battery, where it is, faults and open alerts."""
        now = utcnow()
        carts = list(await db.scalars(select(Cart).where(Cart.store_id == store_id).order_by(Cart.id)))
        tele = {
            t.cart_id: t
            for t in await db.scalars(
                select(CartTelemetry).where(CartTelemetry.cart_id.in_([c.id for c in carts]))
            )
        }
        sessions = {
            s.cart_id: (s, name)
            for s, name in (
                await db.execute(
                    select(CartSession, User.name)
                    .join(User, User.id == CartSession.user_id)
                    .join(Cart, Cart.id == CartSession.cart_id)
                    .where(Cart.store_id == store_id, CartSession.status.in_(OPEN))
                )
            ).all()
        }
        alert_counts = dict(
            (
                await db.execute(
                    select(SecurityAlert.cart_id, func.count())
                    .where(SecurityAlert.store_id == store_id, SecurityAlert.status.in_(OPEN_ALERT))
                    .group_by(SecurityAlert.cart_id)
                )
            ).all()
        )
        out = []
        for c in carts:
            t = tele.get(c.id)
            s = sessions.get(c.id)
            faults = list(t.faults) if t else []
            if t and t.battery_pct < LOW_BATTERY_PCT:
                faults.append("low_battery")
            if t and now - t.seen_at > OFFLINE_AFTER:
                faults.append("offline")
            check: WeightStatus | None = None
            if t and s:
                check = "ok" if t.mismatch_since is None else (await self._check(db, s[0], t.weight_g)).status
            out.append(
                {
                    "cartId": c.id,
                    "status": c.status.value,
                    "sessionId": s[0].id if s else None,
                    "shopperName": s[1] if s else None,
                    "startedAt": _iso(s[0].started_at) if s else None,
                    "batteryPct": t.battery_pct if t else None,
                    "weightG": t.weight_g if t else None,
                    "aisle": t.aisle if t else None,
                    "seenAt": _iso(t.seen_at) if t else None,
                    "faults": faults,
                    "weightCheck": check,
                    "openAlerts": int(alert_counts.get(c.id, 0)),
                }
            )
        return out

    async def set_status(
        self, db: AsyncSession, store_id: str, cart_id: str, status: str, reason: str | None, user_id: str
    ) -> dict[str, Any]:
        """Take a cart out of service for repair (shoppers can't pair it), or put it back."""
        cart = await db.get(Cart, cart_id, with_for_update=True)
        if cart is None or cart.store_id != store_id:
            raise ApiError(404, "cart_not_found")
        if cart.status == CartStatus.in_use or await self._open_session(db, cart_id):
            raise ApiError(409, "cart_in_use")
        cart.status = CartStatus(status)
        db.add(
            AuditLog(actor_id=user_id, action=f"cart.{status}", target=cart_id, details={"reason": reason})
        )
        await db.commit()
        return next(c for c in await self.fleet(db, store_id) if c["cartId"] == cart_id)

    # ---- helpers -------------------------------------------------------------------------------

    async def wire(self, db: AsyncSession, a: SecurityAlert) -> dict[str, Any]:
        shopper = None
        if a.session_id:
            shopper = await db.scalar(
                select(User.name)
                .join(CartSession, CartSession.user_id == User.id)
                .where(CartSession.id == a.session_id)
            )
        handler = await db.scalar(select(User.name).where(User.id == a.handled_by)) if a.handled_by else None
        return {
            "id": a.id,
            "storeId": a.store_id,
            "cartId": a.cart_id,
            "sessionId": a.session_id,
            "shopperName": shopper,
            "kind": a.kind,
            "aisle": a.aisle,
            "details": a.details or {},
            "status": a.status,
            "note": a.note,
            "handledBy": handler,
            "createdAt": _iso(a.created_at),
            "closedAt": _iso(a.closed_at),
        }

    async def _announce(self, db: AsyncSession, type_: str, alert: SecurityAlert) -> None:
        wire = await self.wire(db, alert)
        await self.publish(
            event(type_, store_id=alert.store_id, cart_id=alert.cart_id, source="cart", data=wire),
            [store_room(alert.store_id)],
        )

    async def _open_session(self, db: AsyncSession, cart_id: str) -> CartSession | None:
        return await db.scalar(
            select(CartSession).where(CartSession.cart_id == cart_id, CartSession.status.in_(OPEN))
        )

    async def _open_alert(self, db: AsyncSession, session_id: str, kind: str) -> SecurityAlert | None:
        return await db.scalar(
            select(SecurityAlert).where(
                SecurityAlert.session_id == session_id,
                SecurityAlert.kind == kind,
                SecurityAlert.status.in_(OPEN_ALERT),
            )
        )

    async def _check(self, db: AsyncSession, session: CartSession, measured_g: int) -> WeightCheck:
        qty = await self.carts.quantities(db, session)
        weights = (
            dict(
                (
                    await db.execute(select(Product.id, Product.weight_g).where(Product.id.in_(list(qty))))
                ).all()
            )
            if qty
            else {}
        )
        return weight_check(measured_g, [(weights.get(pid), q) for pid, q in qty.items()])
