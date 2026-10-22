import uuid
from datetime import timedelta

import httpx
import pytest

from smartcart.models import CartSession, CartSessionStatus, utcnow

from .conftest import STAFF, STORE, Api, Item, Server, shopper

pytestmark = pytest.mark.integration


async def test_requires_sign_in(http: httpx.AsyncClient) -> None:
    assert (await http.post("/v1/carts/pair", json={})).status_code == 401


async def test_re_pairing_returns_the_same_session(api: Api) -> None:
    auth, cart = shopper(), await api.new_cart()
    first = await api.pair(auth, cart)
    assert first.status_code == 200
    assert first.json() | {"cartCode": cart, "status": "active", "lines": []} == first.json()
    again = await api.pair(auth, cart)
    assert again.json()["sessionId"] == first.json()["sessionId"]


async def test_refuses_a_cart_someone_else_is_using(api: Api) -> None:
    cart = await api.new_cart()
    assert (await api.pair(shopper(), cart)).status_code == 200
    res = await api.pair(shopper(), cart)
    assert res.status_code == 409
    assert res.json()["error"] == "cart_in_use"


async def test_one_open_cart_per_shopper(api: Api) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    res = await api.pair(auth, await api.new_cart())
    assert res.status_code == 409
    assert res.json()["error"] == "already_shopping"
    assert res.json()["sessionId"] == session_id


async def test_adds_items_with_gst_inclusive_totals_reserving_stock(api: Api, milk: Item, dal: Item) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    before = await api.reserved(dal.product_id)

    await api.add(auth, session_id, milk.code, 2)
    assert (await api.add(auth, session_id, dal.code, 1)).status_code == 200

    snap = await api.snapshot(auth, session_id)
    totals = snap["totals"]
    assert totals["itemCount"] == 3
    assert totals["totalPaise"] == sum(line["lineTotalPaise"] for line in snap["lines"])
    assert totals["subtotalPaise"] + totals["taxPaise"] == totals["totalPaise"]
    assert await api.reserved(dal.product_id) == before + 1


async def test_a_retried_add_applies_once(api: Api, milk: Item) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    request_id = str(uuid.uuid4())
    await api.add(auth, session_id, milk.code, 1, request_id)
    retry = await api.add(auth, session_id, milk.code, 1, request_id)
    assert retry.status_code == 200
    assert retry.json()["line"]["qty"] == 1


async def test_unknown_barcode_in_cart_is_404(api: Api) -> None:
    auth = shopper()
    res = await api.add(auth, await api.session(auth), "2999999999999")
    assert res.status_code == 404
    assert res.json()["error"] == "product_not_found"


async def test_removes_one_unit_or_the_whole_line_and_releases_stock(
    api: Api, http: httpx.AsyncClient, milk: Item
) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    before = await api.reserved(milk.product_id)
    await api.add(auth, session_id, milk.code, 3)
    url = f"/v1/carts/{session_id}/items/{milk.product_id}"

    one = await http.delete(url, params={"requestId": str(uuid.uuid4())}, headers={"authorization": auth})
    assert one.json()["line"]["qty"] == 2

    everything = await http.delete(
        url, params={"qty": "all", "requestId": str(uuid.uuid4())}, headers={"authorization": auth}
    )
    assert everything.json()["line"] is None
    assert everything.json()["totals"]["itemCount"] == 0
    assert await api.reserved(milk.product_id) == before


async def test_hides_another_shoppers_session(api: Api, milk: Item) -> None:
    session_id = await api.session(shopper())
    assert (await api.add(shopper(), session_id, milk.code)).status_code == 404


async def test_rebuilds_the_live_cart_from_the_event_log(api: Api, server: Server, milk: Item) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    await api.add(auth, session_id, milk.code, 2)
    await server.redis.delete(f"cart:{session_id}:items")
    assert (await api.snapshot(auth, session_id))["totals"]["itemCount"] == 2
    # The next add lands on the rebuilt projection, not on top of an empty one.
    await server.redis.delete(f"cart:{session_id}:items")
    assert (await api.add(auth, session_id, milk.code, 1)).json()["line"]["qty"] == 3


async def test_cancelling_frees_the_cart_and_its_reservations(
    api: Api, http: httpx.AsyncClient, dal: Item
) -> None:
    auth, cart = shopper(), await api.new_cart()
    session_id = (await api.pair(auth, cart)).json()["sessionId"]
    before = await api.reserved(dal.product_id)
    await api.add(auth, session_id, dal.code, 2)

    res = await http.post(f"/v1/carts/{session_id}/cancel", headers={"authorization": auth})
    assert res.status_code == 200
    assert await api.reserved(dal.product_id) == before
    assert await api.cart_status(cart) == "available"
    assert (await api.pair(shopper(), cart)).status_code == 200


async def test_an_ended_session_takes_no_more_items(api: Api, http: httpx.AsyncClient, milk: Item) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    await http.post(f"/v1/carts/{session_id}/cancel", headers={"authorization": auth})
    res = await api.add(auth, session_id, milk.code)
    assert res.status_code == 409
    assert res.json() == {"error": "session_not_active", "status": "abandoned"}
    again = await http.post(f"/v1/carts/{session_id}/cancel", headers={"authorization": auth})
    assert again.status_code == 409


async def test_abandons_idle_sessions(api: Api, server: Server, milk: Item) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    await api.add(auth, session_id, milk.code)
    assert await server.carts.sweep_idle(server.maker, 30, utcnow() + timedelta(minutes=31)) >= 1
    async with server.maker() as db:
        assert (await db.get_one(CartSession, session_id)).status == CartSessionStatus.abandoned


async def test_my_cart_finds_the_open_session(api: Api, http: httpx.AsyncClient) -> None:
    auth = shopper()
    assert (await http.get("/v1/me/cart", headers={"authorization": auth})).json() == {"session": None}
    session_id = await api.session(auth)
    mine = (await http.get("/v1/me/cart", headers={"authorization": auth})).json()
    assert mine["session"]["sessionId"] == session_id


async def test_shows_open_sessions_to_staff(api: Api, http: httpx.AsyncClient) -> None:
    session_id = await api.session(shopper())
    res = await http.get(f"/admin/v1/stores/{STORE}/carts", headers={"authorization": STAFF})
    assert res.status_code == 200
    assert session_id in [s["sessionId"] for s in res.json()["sessions"]]
