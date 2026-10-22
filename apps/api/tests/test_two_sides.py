"""Two sides: store-team accounts and their approval, staff sign-in, reservations, tasks and
stock corrections."""

import random
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import select, update

from smartcart import security
from smartcart.models import Barcode, Inventory, Reservation
from smartcart.store_ops import pickup_slots

from .conftest import ADMIN, STAFF, STORE, Api, Item, Server, shopper

integration = pytest.mark.integration
MGR = f"/admin/v1/stores/{STORE}"
FLOOR = f"/staff/v1/stores/{STORE}"
RES = f"/v1/stores/{STORE}/reservations"


def h(token: str) -> dict[str, str]:
    return {"authorization": token}


def phone() -> str:
    return f"9{random.randint(10**8, 10**9 - 1)}"


def temp_password_from(approval: dict[str, Any]) -> str:
    # With SMS_PROVIDER=log the admin sees the text that would have been sent.
    message = approval["sms"]["devMessage"]
    return str(message.split("Temporary password ")[1].split(",")[0])


async def new_staff(http: httpx.AsyncClient, role: str = "floor_staff") -> dict[str, Any]:
    """Runs the whole flow: manager request, admin approval, first sign-in, password change."""
    number = phone()
    req = await http.post(
        f"{MGR}/staff-requests",
        headers=h(STAFF),
        json={"fullName": "Rajesh Kumar", "phone": number, "role": role, "shift": "Morning"},
    )
    assert req.status_code == 201, req.text
    approval = (
        await http.post(
            f"/admin/v1/staff-requests/{req.json()['id']}/review",
            headers=h(ADMIN),
            json={"action": "approve"},
        )
    ).json()
    code = approval["staff"]["staffCode"]
    first = await http.post(
        "/v1/auth/staff/login", json={"login": code, "password": temp_password_from(approval)}
    )
    assert first.status_code == 200, first.text
    token = f"Bearer {first.json()['token']}"
    changed = await http.post(
        "/v1/auth/staff/password",
        headers=h(token),
        json={"currentPassword": temp_password_from(approval), "newPassword": "shelf-and-aisle-7"},
    )
    assert changed.status_code == 200, changed.text
    return {"token": token, "code": code, "phone": number, "id": approval["staff"]["id"]}


# ---- pure helpers ---------------------------------------------------------------------------------


def test_phone_numbers_normalise_to_plus_91() -> None:
    assert security.normalise_phone("98765 43210") == "+919876543210"
    assert security.normalise_phone("+91-98765-43210") == "+919876543210"
    assert security.normalise_phone("09876543210") == "+919876543210"
    assert security.normalise_phone("12345") is None
    assert security.normalise_phone("5876543210") is None  # Indian mobiles start 6-9


def test_passwords_hash_and_policy() -> None:
    hashed = security.hash_password("shelf-and-aisle-7")
    assert security.verify_password(hashed, "shelf-and-aisle-7")
    assert not security.verify_password(hashed, "wrong")
    assert not security.verify_password(None, "anything")
    assert security.password_problem("short") == "password_too_short"
    assert security.password_problem("12345678") == "password_only_digits"
    assert len(security.temp_password()) == 10


def test_pickup_slots_stay_in_store_hours() -> None:
    late = datetime(2026, 10, 22, 16, 10)  # 21:40 in Mumbai
    slots = pickup_slots(late, "Asia/Kolkata", 3)
    assert [s["label"] for s in slots] == ["Fri 08:00–08:30", "Fri 08:30–09:00", "Fri 09:00–09:30"]
    morning = pickup_slots(datetime(2026, 10, 22, 4, 0), "Asia/Kolkata", 1)  # 09:30 IST
    assert morning[0]["label"] == "Thu 10:00–10:30"


# ---- store-team accounts --------------------------------------------------------------------------


@integration
async def test_staff_account_is_created_only_through_approval(http: httpx.AsyncClient) -> None:
    number = phone()
    body = {"fullName": "Rajesh Kumar", "phone": number, "role": "floor_staff", "shift": "Morning"}
    assert (await http.post(f"{MGR}/staff-requests", headers=h(shopper()), json=body)).status_code == 403
    req = (await http.post(f"{MGR}/staff-requests", headers=h(STAFF), json=body)).json()
    assert req["status"] == "pending" and req["phone"] == f"+91{number}"
    # The same number can't be requested twice while one is waiting.
    dup = await http.post(f"{MGR}/staff-requests", headers=h(STAFF), json=body)
    assert dup.status_code == 409 and dup.json()["error"] == "phone_already_registered"

    review = f"/admin/v1/staff-requests/{req['id']}/review"
    assert (await http.post(review, headers=h(STAFF), json={"action": "approve"})).status_code == 403
    no_reason = await http.post(review, headers=h(ADMIN), json={"action": "request_changes"})
    assert no_reason.json()["error"] == "reason_required"
    sent_back = await http.post(
        review, headers=h(ADMIN), json={"action": "request_changes", "note": "Add the shift"}
    )
    assert sent_back.json()["request"]["status"] == "changes_requested"
    fixed = await http.put(
        f"{MGR}/staff-requests/{req['id']}", headers=h(STAFF), json={**body, "shift": "Evening"}
    )
    assert fixed.json()["status"] == "pending" and fixed.json()["shift"] == "Evening"

    approved = (await http.post(review, headers=h(ADMIN), json={"action": "approve"})).json()
    assert approved["request"]["status"] == "approved"
    staff = approved["staff"]
    assert staff["staffCode"].startswith("S01-") and staff["mustChangePassword"] is True
    temp = temp_password_from(approved)
    again = await http.post(review, headers=h(ADMIN), json={"action": "approve"})
    assert again.status_code == 409

    # First sign-in works by staff ID or registered phone, but the password must be changed first.
    login = await http.post("/v1/auth/staff/login", json={"login": f"+91 {number}", "password": temp})
    assert login.status_code == 200 and login.json()["mustChangePassword"] is True
    token = f"Bearer {login.json()['token']}"
    blocked = await http.get(f"{FLOOR}/help", headers=h(token))
    assert blocked.status_code == 403 and blocked.json()["error"] == "password_change_required"
    weak = await http.post(
        "/v1/auth/staff/password", headers=h(token), json={"currentPassword": temp, "newPassword": "1234"}
    )
    assert weak.json()["error"] == "password_too_short"
    ok = await http.post(
        "/v1/auth/staff/password",
        headers=h(token),
        json={"currentPassword": temp, "newPassword": "my-new-pass-1"},
    )
    assert ok.status_code == 200
    assert (await http.get(f"{FLOOR}/help", headers=h(token))).status_code == 200
    # Floor staff are not managers.
    assert (await http.get(f"{MGR}/staff", headers=h(token))).status_code == 403

    me = (await http.get("/v1/me", headers=h(token))).json()
    assert (
        me["side"] == "store"
        and me["role"] == "floor_staff"
        and me["staff"]["staffCode"] == staff["staffCode"]
    )
    assert (await http.get("/v1/me", headers=h(shopper()))).json()["side"] == "shopper"
    roster = (await http.get(f"{MGR}/staff", headers=h(STAFF))).json()["staff"]
    assert any(s["staffCode"] == staff["staffCode"] for s in roster)


@integration
async def test_wrong_passwords_lock_the_account(http: httpx.AsyncClient) -> None:
    person = await new_staff(http)
    for _ in range(5):
        bad = await http.post("/v1/auth/staff/login", json={"login": person["code"], "password": "nope-nope"})
        assert bad.status_code == 401 and bad.json()["error"] == "invalid_credentials"
    locked = await http.post(
        "/v1/auth/staff/login", json={"login": person["code"], "password": "shelf-and-aisle-7"}
    )
    assert locked.status_code == 423 and locked.json()["error"] == "account_locked"
    unknown = await http.post("/v1/auth/staff/login", json={"login": "S01-9999", "password": "whatever-1"})
    assert unknown.status_code == 401


@integration
async def test_deactivation_suspends_at_once_and_needs_approval(http: httpx.AsyncClient) -> None:
    person = await new_staff(http)

    async def login() -> httpx.Response:
        return await http.post(
            "/v1/auth/staff/login", json={"login": person["phone"], "password": "shelf-and-aisle-7"}
        )

    asked = await http.post(
        f"{MGR}/staff-requests/deactivate",
        headers=h(STAFF),
        json={"staffId": person["id"], "reason": "Left the job"},
    )
    assert asked.status_code == 201
    assert (await login()).json()["error"] == "account_inactive"
    assert (await http.get(f"{FLOOR}/help", headers=h(person["token"]))).status_code == 403
    rejected = await http.post(
        f"/admin/v1/staff-requests/{asked.json()['id']}/review",
        headers=h(ADMIN),
        json={"action": "reject", "note": "Still on the rota this week"},
    )
    assert rejected.json()["request"]["status"] == "rejected"
    assert (await login()).status_code == 200

    asked = await http.post(
        f"{MGR}/staff-requests/deactivate",
        headers=h(STAFF),
        json={"staffId": person["id"], "reason": "Left the job"},
    )
    await http.post(
        f"/admin/v1/staff-requests/{asked.json()['id']}/review", headers=h(ADMIN), json={"action": "approve"}
    )
    assert (await login()).json()["error"] == "account_inactive"
    pending = (await http.get("/admin/v1/staff-requests?status=pending", headers=h(ADMIN))).json()["requests"]
    assert all(r["id"] != asked.json()["id"] for r in pending)


# ---- reservations ---------------------------------------------------------------------------------


@pytest.fixture
async def stocked(server: Server) -> Item:
    """A product with plenty free to hold; other tests keep taking milk and dal off the shelf."""
    async with server.maker() as db:
        row = (
            await db.execute(
                select(Barcode.code, Inventory.product_id)
                .join(Barcode, Barcode.product_id == Inventory.product_id)
                .where(Inventory.store_id == STORE, Inventory.on_hand - Inventory.reserved >= 10)
                .order_by(Inventory.on_hand.desc())
                .limit(1)
            )
        ).first()
    assert row, "seed has no well-stocked product"
    return Item(code=row[0], product_id=row[1])


async def first_slot(http: httpx.AsyncClient, auth: str) -> str:
    slots = (await http.get(f"{RES}/slots", headers=h(auth))).json()["slots"]
    return str(slots[0]["start"])


@integration
async def test_reservation_is_held_picked_and_collected(
    http: httpx.AsyncClient, api: Api, stocked: Item
) -> None:
    floor = await new_staff(http)
    me = shopper()
    before = await api.reserved(stocked.product_id)
    slot = await first_slot(http, me)
    made = await http.post(
        RES, headers=h(me), json={"items": [{"productId": stocked.product_id, "qty": 2}], "slotStart": slot}
    )
    assert made.status_code == 201, made.text
    res = made.json()
    assert res["status"] == "reserved" and res["itemCount"] == 2 and res["items"][0]["aisle"]
    assert await api.reserved(stocked.product_id) == before + 2
    second = await http.post(
        RES, headers=h(me), json={"items": [{"productId": stocked.product_id, "qty": 1}], "slotStart": slot}
    )
    assert second.json()["error"] == "reservation_exists"
    bad_slot = await http.post(
        RES,
        headers=h(shopper()),
        json={"items": [{"productId": stocked.product_id, "qty": 1}], "slotStart": "2020-01-01T10:00:00Z"},
    )
    assert bad_slot.json()["error"] == "invalid_slot"

    picklist = (await http.get(f"{FLOOR}/reservations/picklist", headers=h(floor["token"]))).json()[
        "reservations"
    ]
    assert any(r["id"] == res["id"] for r in picklist)
    tasks = (await http.get(f"{FLOOR}/tasks", headers=h(floor["token"]))).json()["tasks"]
    assert any(t["type"] == "pick" and t["refId"] == res["id"] for t in tasks)
    collect_early = await http.post(f"{RES}/{res['id']}/collect", headers=h(me))
    assert collect_early.json()["error"] == "reservation_not_ready"

    cart = await api.new_cart()
    picked = await http.post(
        f"{FLOOR}/reservations/{res['id']}/picked", headers=h(floor["token"]), json={"cartCode": cart}
    )
    assert picked.json()["status"] == "picked" and picked.json()["pickedBy"] == "Rajesh Kumar"
    assert (await api.pair(shopper(), cart)).json()["error"] == "cart_reserved"

    collected = await http.post(f"{RES}/{res['id']}/collect", headers=h(me))
    assert collected.status_code == 200, collected.text
    assert collected.json()["reservation"]["status"] == "collected"
    lines = collected.json()["cart"]["lines"]
    assert [(line["productId"], line["qty"]) for line in lines] == [(stocked.product_id, 2)]
    # The hold moved from the reservation to the cart: still two units reserved, not four.
    assert await api.reserved(stocked.product_id) == before + 2
    board = (await http.get(f"{MGR}/reservations", headers=h(STAFF))).json()["reservations"]
    assert next(r for r in board if r["id"] == res["id"])["status"] == "collected"


@integration
async def test_cancelled_or_expired_reservations_release_stock(
    http: httpx.AsyncClient, api: Api, server: Server, stocked: Item
) -> None:
    before = await api.reserved(stocked.product_id)
    me = shopper()
    slot = await first_slot(http, me)
    res = (
        await http.post(
            RES,
            headers=h(me),
            json={"items": [{"productId": stocked.product_id, "qty": 1}], "slotStart": slot},
        )
    ).json()
    cancelled = await http.delete(f"{RES}/{res['id']}", headers=h(me))
    assert cancelled.json()["status"] == "cancelled"
    assert await api.reserved(stocked.product_id) == before
    assert (await http.get(f"{RES}/mine", headers=h(me))).json()["reservation"]["status"] == "cancelled"

    late = shopper()
    res = (
        await http.post(
            RES,
            headers=h(late),
            json={"items": [{"productId": stocked.product_id, "qty": 1}], "slotStart": slot},
        )
    ).json()
    assert await api.reserved(stocked.product_id) == before + 1
    async with server.maker() as db:
        past = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=3)
        await db.execute(
            update(Reservation).where(Reservation.id == res["id"]).values(slot_start=past, slot_end=past)
        )
        await db.commit()
    assert await server.ops.expire_due(server.maker) >= 1
    assert (await http.get(f"{RES}/mine", headers=h(late))).json()["reservation"]["status"] == "expired"
    assert await api.reserved(stocked.product_id) == before


@integration
async def test_reserving_more_than_is_available_is_refused(http: httpx.AsyncClient, server: Server) -> None:
    async with server.maker() as db:
        row = (
            await db.execute(
                select(Inventory.product_id, Inventory.on_hand - Inventory.reserved)
                .where(Inventory.store_id == STORE, (Inventory.on_hand - Inventory.reserved).between(1, 19))
                .limit(1)
            )
        ).first()
    assert row, "seed has no low-stock product"
    me = shopper()
    slot = await first_slot(http, me)
    res = await http.post(
        RES, headers=h(me), json={"items": [{"productId": row[0], "qty": row[1] + 1}], "slotStart": slot}
    )
    assert res.status_code == 409 and res.json() == res.json() | {
        "error": "not_enough_stock",
        "available": row[1],
    }


# ---- floor work -----------------------------------------------------------------------------------


@integration
async def test_tasks_restock_and_stock_corrections(http: httpx.AsyncClient, api: Api, dal: Item) -> None:
    floor = await new_staff(http)
    board = (await http.get(f"{MGR}/tasks", headers=h(STAFF))).json()["tasks"]
    assert any(t["type"] == "restock" and t["status"] == "open" for t in board), "seed has low-stock items"

    made = await http.post(
        f"{MGR}/tasks",
        headers=h(STAFF),
        json={
            "type": "restock",
            "title": "Restock toor dal",
            "productId": dal.product_id,
            "assignedTo": floor["id"],
        },
    )
    assert made.status_code == 201
    mine = (await http.get(f"{FLOOR}/tasks", headers=h(floor["token"]))).json()["tasks"]
    task = next(t for t in mine if t["id"] == made.json()["id"])
    assert task["assignedName"] == "Rajesh Kumar"

    stock = (await http.get(f"{FLOOR}/stock/{dal.code}", headers=h(floor["token"]))).json()
    done = await http.post(
        f"{FLOOR}/tasks/{task['id']}/done", headers=h(floor["token"]), json={"restocked": 6}
    )
    assert done.status_code == 200
    after = (await http.get(f"{FLOOR}/stock/{dal.code}", headers=h(floor["token"]))).json()
    assert after["onHand"] == stock["onHand"] + 6
    assert (
        await http.post(f"{FLOOR}/tasks/{task['id']}/done", headers=h(floor["token"]), json={})
    ).status_code == 409

    corrected = await http.post(
        f"{FLOOR}/stock-corrections",
        headers=h(floor["token"]),
        json={"barcode": dal.code, "counted": after["onHand"] - 2, "reason": "Two packs damaged"},
    )
    assert corrected.status_code == 201 and corrected.json()["delta"] == -2
    report = (await http.get(f"{MGR}/reports/stock-corrections", headers=h(STAFF))).json()["corrections"]
    assert report[0]["reason"] == "Two packs damaged" and report[0]["staffName"] == "Rajesh Kumar"


@integration
async def test_floor_staff_take_help_and_check_exits(http: httpx.AsyncClient) -> None:
    floor = await new_staff(http)
    me = shopper()
    req = (
        await http.post(
            f"/v1/stores/{STORE}/help",
            headers=h(me),
            json={"topic": "find_item", "note": uuid.uuid4().hex[:6]},
        )
    ).json()
    inbox = (await http.get(f"{FLOOR}/help", headers=h(floor["token"]))).json()["requests"]
    assert any(r["id"] == req["id"] for r in inbox)
    taken = await http.post(
        f"{FLOOR}/help/{req['id']}", headers=h(floor["token"]), json={"action": "acknowledge"}
    )
    assert taken.json()["staffName"] == "Rajesh Kumar"
    mine = (await http.get(f"/v1/stores/{STORE}/help/mine", headers=h(me))).json()["request"]
    assert mine["status"] == "acknowledged" and mine["staffName"] == "Rajesh Kumar"
    await http.post(f"{FLOOR}/help/{req['id']}", headers=h(floor["token"]), json={"action": "resolve"})

    check = await http.post(f"{FLOOR}/exit-checks", headers=h(floor["token"]), json={"code": "ZZZZZZ"})
    assert check.json()["result"] == "not_found"
    assert (
        await http.post(f"{FLOOR}/exit-checks", headers=h(shopper()), json={"code": "ZZZZZZ"})
    ).status_code == 403
