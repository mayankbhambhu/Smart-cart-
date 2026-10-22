from typing import Any

from fastapi import APIRouter, Request

from ..auth import CurrentUser, Db
from ..checkout_service import CheckoutService
from ..errors import ApiError
from ..payments import PaymentError
from .carts import _carts, _session_id

router = APIRouter(prefix="/v1")


def _checkout(request: Request) -> CheckoutService:
    checkout: CheckoutService = request.app.state.checkout
    return checkout


@router.post("/carts/{session_id}/checkout")
async def checkout(session_id: str, request: Request, user: CurrentUser, db: Db) -> dict[str, Any]:
    """Freezes the cart into an order and starts payment. Calling it again resumes the same order."""
    session = await _carts(request).owned_session(db, _session_id(session_id), user.id)
    return (await _checkout(request).checkout(db, session)).wire()


@router.get("/orders/{order_id}")
async def get_order(order_id: str, request: Request, user: CurrentUser, db: Db) -> dict[str, Any]:
    """The order, which is the e-receipt (with the exit code) once paid."""
    service = _checkout(request)
    order = await service.owned_order(db, _session_id(order_id), user.id)
    return (await service.receipt(db, order)).wire()


@router.post("/orders/{order_id}/back-to-cart")
async def back_to_cart(order_id: str, request: Request, user: CurrentUser, db: Db) -> dict[str, bool]:
    """Leave the payment screen to change the cart; the open payment is voided."""
    service = _checkout(request)
    order = await service.owned_order(db, _session_id(order_id), user.id)
    await service.back_to_cart(db, order)
    return {"ok": True}


@router.post("/orders/{order_id}/pay/fake")
async def pay_fake(order_id: str, request: Request, user: CurrentUser, db: Db) -> dict[str, Any]:
    """Development only (PAYMENT_PROVIDER=fake): completes the payment as Stripe's webhook would."""
    service = _checkout(request)
    order = await service.owned_order(db, _session_id(order_id), user.id)
    return (await service.confirm_fake(db, order)).wire()


@router.get("/me/orders")
async def my_orders(request: Request, user: CurrentUser, db: Db) -> dict[str, Any]:
    receipts = await _checkout(request).my_orders(db, user.id)
    return {"orders": [r.wire() for r in receipts]}


@router.post("/payments/stripe/webhook", include_in_schema=False)
async def stripe_webhook(request: Request, db: Db) -> dict[str, bool]:
    """Stripe tells us a payment's outcome. Verified by signature; no user token."""
    service = _checkout(request)
    if service.provider.name != "stripe":
        raise ApiError(404, "not_found")
    try:
        update = service.provider.parse_webhook(await request.body(), request.headers.get("stripe-signature"))
    except PaymentError as err:
        raise ApiError(400, "invalid_signature") from err
    if update is not None:
        await service.apply(db, update)
    return {"received": True}
