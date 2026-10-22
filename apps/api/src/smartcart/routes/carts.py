import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request
from sqlalchemy import select

from ..auth import CurrentUser, Db
from ..cart_service import OPEN, CartService
from ..errors import ApiError
from ..models import CartSession
from ..schemas import AddItemRequest, CartSnapshot, LineChange, PairCartRequest

router = APIRouter(prefix="/v1")


def _carts(request: Request) -> CartService:
    carts: CartService = request.app.state.carts
    return carts


def _session_id(raw: str) -> str:
    try:
        return str(uuid.UUID(raw))
    except ValueError as err:
        raise ApiError(400, "invalid_request") from err


@router.post("/carts/pair", response_model_by_alias=True)
async def pair(body: PairCartRequest, request: Request, user: CurrentUser, db: Db) -> dict[str, Any]:
    snap = await _carts(request).pair(db, user.id, body.cart_code, body.store_id)
    return snap.wire()


@router.get("/carts/{session_id}")
async def get_cart(session_id: str, request: Request, user: CurrentUser, db: Db) -> dict[str, Any]:
    carts = _carts(request)
    session = await carts.owned_session(db, _session_id(session_id), user.id)
    return (await carts.snapshot(db, session)).wire()


@router.post("/carts/{session_id}/items")
async def add_item(
    session_id: str, body: AddItemRequest, request: Request, user: CurrentUser, db: Db
) -> dict[str, Any]:
    carts = _carts(request)
    session = await carts.owned_session(db, _session_id(session_id), user.id)
    change = await carts.add_item(db, session, body.barcode, body.qty, str(body.request_id))
    return change.wire()


@router.delete("/carts/{session_id}/items/{product_id}")
async def remove_item(
    session_id: str,
    product_id: str,
    request: Request,
    user: CurrentUser,
    db: Db,
    requestId: Annotated[uuid.UUID, Query()],
    qty: Annotated[str, Query(pattern=r"^(all|[1-9]\d?)$")] = "1",
) -> dict[str, Any]:
    n: int | Literal["all"] = "all" if qty == "all" else int(qty)
    if n != "all" and n > 50:
        raise ApiError(400, "invalid_request")
    carts = _carts(request)
    session = await carts.owned_session(db, _session_id(session_id), user.id)
    change: LineChange = await carts.remove_item(db, session, _session_id(product_id), n, str(requestId))
    return change.wire()


@router.post("/carts/{session_id}/cancel")
async def cancel(session_id: str, request: Request, user: CurrentUser, db: Db) -> dict[str, bool]:
    """Shopper leaves without buying: releases the cart and the stock it held."""
    carts = _carts(request)
    session = await carts.owned_session(db, _session_id(session_id), user.id)
    await carts.end_session(db, session, "cancelled")
    return {"ok": True}


@router.get("/me/cart")
async def my_cart(request: Request, user: CurrentUser, db: Db) -> dict[str, Any]:
    """The shopper's open session, if any, so the app can resume after a restart."""
    session = await db.scalar(
        select(CartSession).where(CartSession.user_id == user.id, CartSession.status.in_(OPEN))
    )
    snap: CartSnapshot | None = await _carts(request).snapshot(db, session) if session else None
    return {"session": snap.wire() if snap else None}
