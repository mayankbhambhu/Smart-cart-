"""Anti-theft and the cart fleet (milestone 7).

/hw/v1/...                         cart hardware and exit gates, signed with a device key
/staff/v1/stores/{id}/security-... floor staff on the handheld
/admin/v1/stores/{id}/...          the manager dashboard's Security and Cart fleet pages
"""

from typing import Annotated, Any

from fastapi import APIRouter, Header, Request

from ..auth import Db, FloorStaff, Manager
from ..cart_guard import CartGuard
from ..schemas import CartStatusRequest, GatePassRequest, SecurityActionRequest, TelemetryRequest

hw_router = APIRouter(prefix="/hw/v1")
floor_router = APIRouter(prefix="/staff/v1/stores/{store_id}")
manager_router = APIRouter(prefix="/admin/v1/stores/{store_id}")

DeviceKey = Annotated[str | None, Header(alias="x-device-key")]


def _guard(request: Request) -> CartGuard:
    guard: CartGuard = request.app.state.guard
    return guard


@hw_router.post("/carts/{cart_id}/telemetry")
async def telemetry(
    cart_id: str, body: TelemetryRequest, request: Request, db: Db, key: DeviceKey = None
) -> dict[str, Any]:
    """A cart's reading: battery, basket weight, aisle beacon, faults. Answers with the weight check
    so the cart's own light can show it."""
    guard = _guard(request)
    guard.check_device(f"cart:{cart_id}", key)
    return await guard.telemetry(db, cart_id, body.model_dump())


@hw_router.post("/stores/{store_id}/gates/{gate_id}/pass")
async def gate_pass(
    store_id: str, gate_id: str, body: GatePassRequest, request: Request, db: Db, key: DeviceKey = None
) -> dict[str, Any]:
    """The exit gate read a cart's tag. "alert" means it hasn't paid; the gate can chime."""
    guard = _guard(request)
    guard.check_device(f"gate:{store_id}:{gate_id}", key)
    return await guard.gate_pass(db, store_id, gate_id, body.cart_id)


@floor_router.get("/security-alerts")
async def floor_alerts(store_id: str, _: FloorStaff, request: Request, db: Db) -> dict[str, Any]:
    return {"storeId": store_id, "alerts": await _guard(request).alerts(db, store_id, open_only=True)}


@floor_router.post("/security-alerts/{alert_id}")
async def floor_act(
    store_id: str, alert_id: str, body: SecurityActionRequest, staff: FloorStaff, request: Request, db: Db
) -> dict[str, Any]:
    return await _guard(request).act(db, store_id, alert_id, body.action, body.note, staff.user_id)


@manager_router.get("/security-alerts")
async def alerts(
    store_id: str, _: Manager, request: Request, db: Db, openOnly: bool = True
) -> dict[str, Any]:
    """Open alerts, or everything from the last day."""
    return {"storeId": store_id, "alerts": await _guard(request).alerts(db, store_id, open_only=openOnly)}


@manager_router.post("/security-alerts/{alert_id}")
async def act(
    store_id: str, alert_id: str, body: SecurityActionRequest, staff: Manager, request: Request, db: Db
) -> dict[str, Any]:
    return await _guard(request).act(db, store_id, alert_id, body.action, body.note, staff.user_id)


@manager_router.get("/fleet")
async def fleet(store_id: str, _: Manager, request: Request, db: Db) -> dict[str, Any]:
    """Every cart with its battery, aisle, faults, shopper and open alerts."""
    return {"storeId": store_id, "carts": await _guard(request).fleet(db, store_id)}


@manager_router.post("/carts/{cart_id}/status")
async def cart_status(
    store_id: str, cart_id: str, body: CartStatusRequest, staff: Manager, request: Request, db: Db
) -> dict[str, Any]:
    """Out of service for repair (shoppers can't pair it), or back in service."""
    return await _guard(request).set_status(db, store_id, cart_id, body.status, body.reason, staff.user_id)
