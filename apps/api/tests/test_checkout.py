import hashlib
import hmac
import json
import time

import httpx
import pytest

from smartcart.checkout_service import EXIT_ALPHABET, exit_code_from
from smartcart.payments import PaymentError, StripeProvider

from .conftest import STAFF, STORE, Api, Item, Server, shopper
from .test_contracts import check
from .test_realtime import connected


def stripe_signed(payload: bytes, secret: str) -> str:
    ts = int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={ts},v1={sig}"


def test_stripe_webhooks_are_verified_and_mapped() -> None:
    provider = StripeProvider("sk_test_x", "whsec_test", "pk_test_x")
    body = json.dumps(
        {
            "id": "evt_1",
            "object": "event",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": "pi_123", "object": "payment_intent"}},
        }
    ).encode()
    update = provider.parse_webhook(body, stripe_signed(body, "whsec_test"))
    assert update is not None
    assert (update.provider_payment_id, update.status) == ("pi_123", "succeeded")
    with pytest.raises(PaymentError):
        provider.parse_webhook(body, stripe_signed(body, "whsec_wrong"))
    other = json.dumps(
        {"id": "evt_2", "object": "event", "type": "charge.updated", "data": {"object": {}}}
    ).encode()
    assert provider.parse_webhook(other, stripe_signed(other, "whsec_test")) is None


def test_exit_codes_are_read_from_typed_text_or_the_qr() -> None:
    assert exit_code_from(" k7m2qa ") == "K7M2QA"
    assert exit_code_from("smartcart://exit?order=abc&code=K7M2QA") == "K7M2QA"


async def checkout(api: Api, auth: str, session_id: str) -> httpx.Response:
    return await api.http.post(f"/v1/carts/{session_id}/checkout", headers={"authorization": auth})


async def pay(api: Api, auth: str, order_id: str) -> httpx.Response:
    return await api.http.post(f"/v1/orders/{order_id}/pay/fake", headers={"authorization": auth})


async def on_hand(server: Server, product_id: str) -> int:
    from smartcart.models import Inventory

    async with server.maker() as db:
        return (await db.get_one(Inventory, (STORE, product_id))).on_hand


@pytest.mark.integration
async def test_an_empty_cart_cannot_check_out(api: Api) -> None:
    auth = shopper()
    res = await checkout(api, auth, await api.session(auth))
    assert res.status_code == 409
    assert res.json()["error"] == "cart_empty"


@pytest.mark.integration
async def test_checkout_freezes_the_cart_and_retries_return_the_same_order(
    api: Api, milk: Item, dal: Item
) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    await api.add(auth, session_id, milk.code, 2)
    await api.add(auth, session_id, dal.code, 1)

    res = await checkout(api, auth, session_id)
    assert res.status_code == 200, res.text
    body = res.json()
    check("CheckoutResponse", body)
    order = body["order"]
    assert order["status"] == "pending_payment"
    assert order["exitCode"] is None
    assert order["totals"] == (await api.snapshot(auth, session_id))["totals"]
    assert body["payment"]["provider"] == "fake"
    assert (await api.snapshot(auth, session_id))["status"] == "checking_out"

    blocked = await api.add(auth, session_id, milk.code)
    assert blocked.status_code == 409
    again = await checkout(api, auth, session_id)
    assert again.json()["order"]["orderId"] == order["orderId"]


@pytest.mark.integration
async def test_paying_sells_the_stock_frees_the_cart_and_issues_an_exit_code(
    api: Api, server: Server, http: httpx.AsyncClient, milk: Item
) -> None:
    auth, cart = shopper(), await api.new_cart()
    session_id = (await api.pair(auth, cart)).json()["sessionId"]
    await api.add(auth, session_id, milk.code, 3)
    stock_before, reserved_before = (
        await on_hand(server, milk.product_id),
        await api.reserved(milk.product_id),
    )
    order_id = (await checkout(api, auth, session_id)).json()["order"]["orderId"]

    async with connected(server, auth) as phone:
        await phone.join(room="cart", sessionId=session_id)
        res = await pay(api, auth, order_id)
        assert res.status_code == 200, res.text
        paid = await phone.next("order.paid")
        assert paid["data"]["orderId"] == order_id
        check("SmartCartEvent", paid)
        assert (await phone.next("cart.session_ended"))["data"]["reason"] == "paid"

    receipt = res.json()
    check("Receipt", receipt)
    assert receipt["status"] == "paid"
    code = receipt["exitCode"]
    assert len(code) == 6 and set(code) <= set(EXIT_ALPHABET)
    assert receipt["exitQr"] == f"smartcart://exit?order={order_id}&code={code}"
    gst = receipt["gstSummary"]
    assert sum(r["taxablePaise"] + r["taxPaise"] for r in gst) == receipt["totals"]["totalPaise"]

    assert await on_hand(server, milk.product_id) == stock_before - 3
    assert await api.reserved(milk.product_id) == reserved_before - 3
    assert await api.cart_status(cart) == "available"
    assert (await http.get("/v1/me/cart", headers={"authorization": auth})).json() == {"session": None}
    mine = (await http.get("/v1/me/orders", headers={"authorization": auth})).json()["orders"]
    assert [o["orderId"] for o in mine] == [order_id]
    assert (await pay(api, auth, order_id)).status_code == 409


@pytest.mark.integration
async def test_back_to_cart_reopens_scanning_and_reprices_the_same_order(
    api: Api, http: httpx.AsyncClient, milk: Item, dal: Item
) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    await api.add(auth, session_id, milk.code, 1)
    first = (await checkout(api, auth, session_id)).json()["order"]

    res = await http.post(f"/v1/orders/{first['orderId']}/back-to-cart", headers={"authorization": auth})
    assert res.status_code == 200
    assert (await api.add(auth, session_id, dal.code, 1)).status_code == 200
    second = (await checkout(api, auth, session_id)).json()["order"]
    assert second["orderId"] == first["orderId"]
    assert second["totals"]["itemCount"] == 2
    assert second["totals"]["totalPaise"] > first["totals"]["totalPaise"]
    receipt = (await pay(api, auth, second["orderId"])).json()
    assert receipt["totals"]["itemCount"] == 2


@pytest.mark.integration
async def test_orders_are_private(api: Api, http: httpx.AsyncClient, milk: Item) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    await api.add(auth, session_id, milk.code)
    order_id = (await checkout(api, auth, session_id)).json()["order"]["orderId"]
    other = {"authorization": shopper()}
    assert (await http.get(f"/v1/orders/{order_id}", headers=other)).status_code == 404
    assert (await http.post(f"/v1/orders/{order_id}/pay/fake", headers=other)).status_code == 404


@pytest.mark.integration
async def test_staff_check_exit_codes_once(api: Api, http: httpx.AsyncClient, milk: Item) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    await api.add(auth, session_id, milk.code)
    order_id = (await checkout(api, auth, session_id)).json()["order"]["orderId"]
    receipt = (await pay(api, auth, order_id)).json()
    url = f"/admin/v1/stores/{STORE}/exit-checks"
    staff = {"authorization": STAFF}

    assert (
        await http.post(url, json={"code": receipt["exitCode"]}, headers={"authorization": auth})
    ).status_code == 403
    first = (await http.post(url, json={"code": receipt["exitQr"]}, headers=staff)).json()
    check("ExitCheckResponse", first)
    assert first["result"] == "ok"
    assert first["order"]["orderId"] == order_id
    again = (await http.post(url, json={"code": receipt["exitCode"].lower()}, headers=staff)).json()
    assert again["result"] == "already_used"
    assert (await http.post(url, json={"code": "ZZZZZZ"}, headers=staff)).json() == {
        "result": "not_found",
        "order": None,
        "bagCheck": None,
    }

    orders = (await http.get(f"/admin/v1/stores/{STORE}/orders", headers=staff)).json()["orders"]
    row = next(o for o in orders if o["orderId"] == order_id)
    assert row["status"] == "paid" and row["itemCount"] == 1 and row["exitUsedAt"]


@pytest.mark.integration
async def test_stripe_webhook_is_off_with_the_fake_provider(http: httpx.AsyncClient) -> None:
    assert (await http.post("/v1/payments/stripe/webhook", content=b"{}")).status_code == 404
