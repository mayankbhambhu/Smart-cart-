"""The two sides' routes: store-team sign-in, the handheld's staff mode, reservations, and the
manager and admin-team pages.

/v1/...        shoppers (any signed-in user), plus the store team's sign-in
/staff/v1/...  the handheld's staff mode: anyone on the store team at that store
/admin/v1/...  the manager dashboard; /admin/v1/staff-requests is the SmartCart admin team's
"""

from typing import Any

from fastapi import APIRouter, Request

from ..assist_service import AssistService
from ..auth import Admin, CurrentUser, Db, FloorStaff, Manager
from ..checkout_service import CheckoutService
from ..schemas import (
    ChangePasswordRequest,
    ExitCheckRequest,
    HelpActionRequest,
    ReservationCreateRequest,
    ReservationPickedRequest,
    StaffCreateRequest,
    StaffDeactivateRequest,
    StaffLoginRequest,
    StaffReviewRequest,
    StockCorrectionRequest,
    TaskAssignRequest,
    TaskCreateRequest,
    TaskDoneRequest,
)
from ..staff_service import StaffService
from ..store_ops import StoreOps

auth_router = APIRouter(prefix="/v1")
shopper_router = APIRouter(prefix="/v1/stores/{store_id}/reservations")
floor_router = APIRouter(prefix="/staff/v1/stores/{store_id}")
manager_router = APIRouter(prefix="/admin/v1/stores/{store_id}")
admin_team_router = APIRouter(prefix="/admin/v1/staff-requests")


def _staff(request: Request) -> StaffService:
    service: StaffService = request.app.state.staff
    return service


def _ops(request: Request) -> StoreOps:
    service: StoreOps = request.app.state.ops
    return service


# ---- sign-in and who am I ---------------------------------------------------------------------


@auth_router.post("/auth/staff/login")
async def staff_login(body: StaffLoginRequest, request: Request, db: Db) -> dict[str, Any]:
    """Store-team sign-in with staff ID or registered phone, plus password."""
    return await _staff(request).login(db, body.login, body.password)


@auth_router.post("/auth/staff/password")
async def change_password(
    body: ChangePasswordRequest, user: CurrentUser, request: Request, db: Db
) -> dict[str, Any]:
    return await _staff(request).change_password(db, user.id, body.current_password, body.new_password)


@auth_router.get("/me")
async def me(user: CurrentUser, request: Request, db: Db) -> dict[str, Any]:
    """Which side of the app to show. Decided by the account's role on the server."""
    return {"userId": user.id, "name": user.name, **(await _staff(request).me(db, user.id))}


# ---- shopper: reservations --------------------------------------------------------------------


@shopper_router.get("/slots")
async def slots(store_id: str, _: CurrentUser, request: Request, db: Db) -> dict[str, Any]:
    return {"slots": await _ops(request).slots(db, store_id)}


@shopper_router.post("", status_code=201)
async def reserve(
    store_id: str, body: ReservationCreateRequest, user: CurrentUser, request: Request, db: Db
) -> dict[str, Any]:
    items = [{"productId": i.product_id, "qty": i.qty} for i in body.items]
    return await _ops(request).reserve(db, store_id, user.id, items, body.slot_start)


@shopper_router.get("/mine")
async def my_reservation(store_id: str, user: CurrentUser, request: Request, db: Db) -> dict[str, Any]:
    return {"reservation": await _ops(request).mine(db, store_id, user.id)}


@shopper_router.delete("/{reservation_id}")
async def cancel_reservation(
    store_id: str, reservation_id: str, user: CurrentUser, request: Request, db: Db
) -> dict[str, Any]:
    return await _ops(request).cancel(db, store_id, reservation_id, user.id)


@shopper_router.post("/{reservation_id}/collect")
async def collect_reservation(
    store_id: str, reservation_id: str, user: CurrentUser, request: Request, db: Db
) -> dict[str, Any]:
    return await _ops(request).collect(db, store_id, reservation_id, user.id)


# ---- staff mode on the handheld ---------------------------------------------------------------


@floor_router.get("/help")
async def help_inbox(store_id: str, _: FloorStaff, request: Request, db: Db) -> dict[str, Any]:
    assist: AssistService = request.app.state.assist
    return {"storeId": store_id, "requests": await assist.store_help(db, store_id, open_only=True)}


@floor_router.post("/help/{request_id}")
async def help_action(
    store_id: str, request_id: str, body: HelpActionRequest, staff: FloorStaff, request: Request, db: Db
) -> dict[str, Any]:
    assist: AssistService = request.app.state.assist
    view = await assist.update_help(
        db, store_id=store_id, request_id=request_id, action=body.action, actor_id=staff.user_id, staff=True
    )
    return view.wire()


@floor_router.get("/reservations/picklist")
async def pick_list(store_id: str, _: FloorStaff, request: Request, db: Db) -> dict[str, Any]:
    return {"storeId": store_id, "reservations": await _ops(request).pick_list(db, store_id)}


@floor_router.post("/reservations/{reservation_id}/picked")
async def picked(
    store_id: str,
    reservation_id: str,
    body: ReservationPickedRequest,
    staff: FloorStaff,
    request: Request,
    db: Db,
) -> dict[str, Any]:
    return await _ops(request).picked(db, store_id, reservation_id, staff.user_id, body.cart_code)


@floor_router.get("/tasks")
async def my_tasks(store_id: str, staff: FloorStaff, request: Request, db: Db) -> dict[str, Any]:
    return {"storeId": store_id, "tasks": await _ops(request).tasks(db, store_id, staff_id=staff.id)}


@floor_router.post("/tasks/{task_id}/done")
async def task_done(
    store_id: str, task_id: str, body: TaskDoneRequest, staff: FloorStaff, request: Request, db: Db
) -> dict[str, Any]:
    await _ops(request).finish_task(db, store_id, task_id, staff.user_id, body.restocked)
    return {"ok": True}


@floor_router.get("/stock/{barcode}")
async def stock(store_id: str, barcode: str, _: FloorStaff, request: Request, db: Db) -> dict[str, Any]:
    return await _ops(request).stock_for(db, store_id, barcode)


@floor_router.post("/stock-corrections", status_code=201)
async def stock_correction(
    store_id: str, body: StockCorrectionRequest, staff: FloorStaff, request: Request, db: Db
) -> dict[str, Any]:
    return await _ops(request).correct_stock(
        db, store_id, staff.user_id, body.barcode, body.counted, body.reason
    )


@floor_router.post("/exit-checks")
async def exit_check(
    store_id: str, body: ExitCheckRequest, _: FloorStaff, request: Request, db: Db
) -> dict[str, Any]:
    checkout: CheckoutService = request.app.state.checkout
    return (await checkout.check_exit(db, store_id, body.code)).wire()


# ---- manager dashboard ------------------------------------------------------------------------


@manager_router.get("/reservations")
async def reservations_board(store_id: str, _: Manager, request: Request, db: Db) -> dict[str, Any]:
    return {"storeId": store_id, "reservations": await _ops(request).board(db, store_id)}


@manager_router.get("/tasks")
async def task_board(store_id: str, _: Manager, request: Request, db: Db) -> dict[str, Any]:
    return {"storeId": store_id, "tasks": await _ops(request).tasks(db, store_id)}


@manager_router.post("/tasks", status_code=201)
async def create_task(
    store_id: str, body: TaskCreateRequest, staff: Manager, request: Request, db: Db
) -> dict[str, Any]:
    task_id = await _ops(request).create_task(db, store_id, staff.user_id, body.wire())
    return {"id": task_id}


@manager_router.post("/tasks/{task_id}/assign")
async def assign_task(
    store_id: str, task_id: str, body: TaskAssignRequest, _: Manager, request: Request, db: Db
) -> dict[str, Any]:
    await _ops(request).assign_task(db, store_id, task_id, body.assigned_to)
    return {"ok": True}


@manager_router.get("/staff")
async def staff_list(store_id: str, _: Manager, request: Request, db: Db) -> dict[str, Any]:
    return {"storeId": store_id, "staff": await _staff(request).store_staff(db, store_id)}


@manager_router.post("/staff/{staff_id}/resend-password")
async def resend_password(
    store_id: str, staff_id: str, staff: Manager, request: Request, db: Db
) -> dict[str, Any]:
    return await _staff(request).resend_temp_password(db, store_id, staff_id, staff.user_id)


@manager_router.get("/staff-requests")
async def store_requests(store_id: str, _: Manager, request: Request, db: Db) -> dict[str, Any]:
    return {"storeId": store_id, "requests": await _staff(request).store_requests(db, store_id)}


@manager_router.post("/staff-requests", status_code=201)
async def request_staff(
    store_id: str, body: StaffCreateRequest, staff: Manager, request: Request, db: Db
) -> dict[str, Any]:
    return await _staff(request).request_create(db, store_id, staff.user_id, body.wire())


@manager_router.put("/staff-requests/{request_id}")
async def resubmit_request(
    store_id: str, request_id: str, body: StaffCreateRequest, staff: Manager, request: Request, db: Db
) -> dict[str, Any]:
    return await _staff(request).resubmit(db, store_id, request_id, staff.user_id, body.wire())


@manager_router.post("/staff-requests/deactivate", status_code=201)
async def request_deactivation(
    store_id: str, body: StaffDeactivateRequest, staff: Manager, request: Request, db: Db
) -> dict[str, Any]:
    return await _staff(request).request_deactivate(db, store_id, staff.user_id, body.staff_id, body.reason)


@manager_router.get("/reports/stock-corrections")
async def corrections_report(
    store_id: str, _: Manager, request: Request, db: Db, days: int = 7
) -> dict[str, Any]:
    return {
        "storeId": store_id,
        "days": days,
        "corrections": await _ops(request).corrections(db, store_id, days),
    }


# ---- SmartCart admin team ----------------------------------------------------------------------


@admin_team_router.get("")
async def all_requests(_: Admin, request: Request, db: Db, status: str | None = None) -> dict[str, Any]:
    if status not in (None, "pending", "approved", "rejected", "changes_requested"):
        status = None
    return {"requests": await _staff(request).pending(db, status)}


@admin_team_router.post("/{request_id}/review")
async def review_request(
    request_id: str, body: StaffReviewRequest, staff: Admin, request: Request, db: Db
) -> dict[str, Any]:
    return await _staff(request).review(db, request_id, staff.user_id, body.action, body.note)
