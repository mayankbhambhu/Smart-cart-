"""The API must speak the shared contract in packages/contracts, which the app and dashboard are built on.
Validates real responses and pushed events against the exported JSON Schemas."""

import json
import uuid
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from .conftest import ADMIN, STAFF, Api, Item, Server, shopper
from .test_realtime import connected

BASE = "/v1/stores/S-01"
SCHEMA_DIR = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "schema"


def check(name: str, value: Any) -> None:
    schema = json.loads((SCHEMA_DIR / f"{name}.schema.json").read_text())
    errors = [f"{list(e.path)}: {e.message}" for e in Draft202012Validator(schema).iter_errors(value)]
    assert not errors, f"{name} does not match the contract: {errors}"


@pytest.mark.integration
async def test_snapshots_and_events_match_the_contract(api: Api, server: Server, milk: Item) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    async with connected(server, auth) as phone:
        await phone.join(room="cart", sessionId=session_id)
        check("SmartCartEvent", await phone.next("cart.snapshot"))
        await api.add(auth, session_id, milk.code, 2)
        check("SmartCartEvent", await phone.next("cart.item_added"))
        check("CartSnapshot", await api.snapshot(auth, session_id))
        await api.http.delete(
            f"/v1/carts/{session_id}/items/{milk.product_id}",
            params={"qty": "all", "requestId": str(uuid.uuid4())},
            headers={"authorization": auth},
        )
        check("SmartCartEvent", await phone.next("cart.item_removed"))


def test_requests_the_app_sends_are_valid() -> None:
    check("PairCartRequest", {"cartCode": "C-0001", "storeId": "S-01"})
    check(
        "AddItemRequest",
        {"barcode": "2000000000015", "qty": 1, "requestId": "6f1c1d1e-0000-4000-8000-000000000001"},
    )


@pytest.mark.integration
async def test_find_it_fast_responses_match_the_contract(api: Api, server: Server, dal: Item) -> None:
    base = "/v1/stores/S-01"
    check("SearchResponse", (await api.http.get(f"{base}/products/search", params={"q": "dal"})).json())
    check("SectionsResponse", (await api.http.get("/v1/sections")).json())
    browse = await api.http.get("/v1/products", params={"section": "meat-fish", "food_type": "non_veg"})
    check("BrowseResponse", browse.json())
    route = await api.http.post(f"{base}/lists/route", json={"lines": ["milk", "atta", "unicorn"]})
    check("RouteListResponse", route.json())

    auth = shopper()
    ask = await api.http.post(
        f"{base}/assistant", headers={"authorization": auth}, json={"message": "toor dal?"}
    )
    check("AskResponse", ask.json())
    insights = await api.http.get(
        f"/admin{base}/insights", headers={"authorization": "Bearer dev:staff-demo"}
    )
    check("StoreInsights", insights.json())

    session_id = await api.session(auth)
    await api.add(auth, session_id, dal.code)
    async with connected(server, auth) as phone:
        await phone.join(room="cart", sessionId=session_id)
        await phone.next("cart.snapshot")
        await api.http.post(f"{base}/help", headers={"authorization": auth}, json={"topic": "stock"})
        check("SmartCartEvent", await phone.next("help.requested"))


@pytest.mark.integration
async def test_two_sides_responses_and_events_match_the_contract(api: Api, server: Server) -> None:
    from .test_two_sides import FLOOR, MGR, RES, first_slot, h, phone, temp_password_from

    http = api.http
    req = await http.post(
        f"{MGR}/staff-requests",
        headers=h(STAFF),
        json={"fullName": "Meena Joshi", "phone": phone(), "role": "floor_staff"},
    )
    check("StaffRequest", req.json())
    approved = await http.post(
        f"/admin/v1/staff-requests/{req.json()['id']}/review", headers=h(ADMIN), json={"action": "approve"}
    )
    check("StaffReviewResponse", approved.json())
    temp = temp_password_from(approved.json())
    login = await http.post(
        "/v1/auth/staff/login", json={"login": approved.json()["staff"]["staffCode"], "password": temp}
    )
    check("StaffLoginResponse", login.json())
    token = f"Bearer {login.json()['token']}"
    await http.post(
        "/v1/auth/staff/password",
        headers=h(token),
        json={"currentPassword": temp, "newPassword": "aisle-b1-dal"},
    )
    check("MeResponse", (await http.get("/v1/me", headers=h(token))).json())
    check("MeResponse", (await http.get("/v1/me", headers=h(shopper()))).json())
    for account in (await http.get(f"{MGR}/staff", headers=h(STAFF))).json()["staff"]:
        check("StaffAccount", account)

    auth = shopper()
    product = (await http.get(f"{BASE}/products/search", params={"q": "biscuit"})).json()["results"][0]
    async with connected(server, STAFF) as dashboard:
        await dashboard.join(room="store", storeId="S-01")
        made = await http.post(
            RES,
            headers=h(auth),
            json={
                "items": [{"productId": product["productId"], "qty": 1}],
                "slotStart": await first_slot(http, auth),
            },
        )
        check("Reservation", made.json())
        check("SmartCartEvent", await dashboard.next("reservation.created"))
        cart = await api.new_cart()
        await http.post(
            f"{FLOOR}/reservations/{made.json()['id']}/picked", headers=h(token), json={"cartCode": cart}
        )
        check("SmartCartEvent", await dashboard.next("reservation.updated"))
        check("SmartCartEvent", await dashboard.next("task.updated"))
    check("CollectResponse", (await http.post(f"{RES}/{made.json()['id']}/collect", headers=h(auth))).json())

    for task in (await http.get(f"{MGR}/tasks", headers=h(STAFF))).json()["tasks"]:
        check("StaffTask", task)
    barcode = await _barcode(server, product["productId"])
    check("StockLevel", (await http.get(f"{FLOOR}/stock/{barcode}", headers=h(token))).json())
    current = (await http.get(f"{FLOOR}/stock/{barcode}", headers=h(token))).json()["onHand"]
    await http.post(
        f"{FLOOR}/stock-corrections",
        headers=h(token),
        json={"barcode": barcode, "counted": current, "reason": "Recount, no change"},
    )
    for row in (await http.get(f"{MGR}/reports/stock-corrections", headers=h(STAFF))).json()["corrections"]:
        check("StockCorrection", row)


async def _barcode(server: Server, product_id: str) -> str:
    from sqlalchemy import select

    from smartcart.models import Barcode

    async with server.maker() as db:
        return str(await db.scalar(select(Barcode.code).where(Barcode.product_id == product_id).limit(1)))
