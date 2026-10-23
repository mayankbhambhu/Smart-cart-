"""Milestone 7: the weight check, security alerts, the exit gate and the cart fleet."""

import uuid
from collections.abc import Iterator
from datetime import timedelta

import httpx
import pytest

from smartcart.cart_guard import ALERT_AFTER, weight_check

from .conftest import STAFF, STORE, Api, Item, Server, shopper
from .test_realtime import connected

ADMIN_BASE = f"/admin/v1/stores/{STORE}"
MILK_G = 515  # Amul Toned Milk 500 ml in the seed


def test_weight_check_allows_for_scale_drift_and_never_guesses() -> None:
    assert weight_check(1030 + 60, [(515, 2)]).status == "ok"
    extra = weight_check(1030 + 450, [(515, 2)])
    assert (extra.status, extra.expected_g, extra.diff_g) == ("extra", 1030, 450)
    assert weight_check(515, [(515, 2)]).status == "missing"
    assert weight_check(5000, [(515, 1), (None, 1)]).status == "unknown"
    assert weight_check(10_000 + 500, [(10_000, 1)]).status == "ok", "6% of a heavy basket"
    assert weight_check(0, []).status == "ok"


integration = pytest.mark.integration


def h(auth: str) -> dict[str, str]:
    return {"authorization": auth}


@pytest.fixture
def no_wait(server: Server) -> Iterator[None]:
    server.guard.alert_after = timedelta(0)
    yield
    server.guard.alert_after = ALERT_AFTER


async def reading(
    server: Server, http: httpx.AsyncClient, cart: str, weight: int, **extra: object
) -> httpx.Response:
    body = {"batteryPct": 80, "weightG": weight, "aisle": "A1", **extra}
    key = server.guard.device_key(f"cart:{cart}")
    return await http.post(f"/hw/v1/carts/{cart}/telemetry", json=body, headers={"x-device-key": key})


async def cart_code(api: Api, auth: str, session_id: str) -> str:
    return str((await api.snapshot(auth, session_id))["cartCode"])


@integration
async def test_unscanned_weight_nudges_the_shopper_then_alerts_staff_and_clears_itself(
    api: Api, server: Server, http: httpx.AsyncClient, milk: Item
) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    cart = await cart_code(api, auth, session_id)
    await api.add(auth, session_id, milk.code, 2)

    bad = await http.post(
        f"/hw/v1/carts/{cart}/telemetry", json={"batteryPct": 80, "weightG": 0}, headers={"x-device-key": "x"}
    )
    assert bad.status_code == 401
    assert (await reading(server, http, cart, 2 * MILK_G + 40)).json()["weightCheck"] == "ok"

    async with connected(server, auth) as phone, connected(server, STAFF) as staff:
        await phone.join(room="cart", sessionId=session_id)
        await staff.join(room="store", storeId=STORE)
        res = (await reading(server, http, cart, 2 * MILK_G + 450)).json()
        assert res["weightCheck"] == "extra" and res["diffG"] == 450
        nudge = await phone.next("cart.weight_check")
        assert nudge["data"]["status"] == "extra" and nudge["source"] == "cart"
        # The shopper gets the first chance: no alert before ALERT_AFTER.
        open_now = (await http.get(f"{ADMIN_BASE}/security-alerts", headers=h(STAFF))).json()["alerts"]
        assert not any(a["sessionId"] == session_id for a in open_now)

        server.guard.alert_after = timedelta(0)
        try:
            await reading(server, http, cart, 2 * MILK_G + 450)
        finally:
            server.guard.alert_after = ALERT_AFTER
        alert = (await staff.next("security.alert"))["data"]
        assert alert["kind"] == "unscanned_item" and alert["cartId"] == cart and alert["aisle"] == "A1"
        assert alert["details"]["diffG"] == 450 and alert["status"] == "open"

        # The shopper scans the item (here: the weight matches again), and the alert clears.
        await reading(server, http, cart, 2 * MILK_G)
        assert (await phone.next("cart.weight_check"))["data"]["status"] == "ok"
        cleared = (await staff.next("security.updated"))["data"]
        assert cleared["id"] == alert["id"] and cleared["status"] == "cleared"


@integration
async def test_an_open_alert_asks_for_a_bag_check_at_the_exit(
    api: Api, server: Server, http: httpx.AsyncClient, milk: Item, no_wait: None
) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    cart = await cart_code(api, auth, session_id)
    await api.add(auth, session_id, milk.code, 1)
    await reading(server, http, cart, MILK_G + 600)
    await reading(server, http, cart, MILK_G + 600)
    alerts = (await http.get(f"{ADMIN_BASE}/security-alerts", headers=h(STAFF))).json()["alerts"]
    alert = next(a for a in alerts if a["sessionId"] == session_id)
    ack = await http.post(
        f"{ADMIN_BASE}/security-alerts/{alert['id']}", headers=h(STAFF), json={"action": "acknowledge"}
    )
    assert ack.json()["status"] == "acknowledged" and ack.json()["handledBy"]

    order_id = (await http.post(f"/v1/carts/{session_id}/checkout", headers=h(auth))).json()["order"][
        "orderId"
    ]
    code = (await http.post(f"/v1/orders/{order_id}/pay/fake", headers=h(auth))).json()["exitCode"]
    exit_check = (await http.post(f"{ADMIN_BASE}/exit-checks", json={"code": code}, headers=h(STAFF))).json()
    assert exit_check["result"] == "ok"
    assert (
        exit_check["bagCheck"]["alertId"] == alert["id"] and "600 g more" in exit_check["bagCheck"]["reason"]
    )

    done = await http.post(
        f"{ADMIN_BASE}/security-alerts/{alert['id']}",
        headers=h(STAFF),
        json={"action": "resolve", "note": "Bag checked, receipt fine"},
    )
    assert done.json()["status"] == "resolved" and done.json()["closedAt"]
    again = await http.post(
        f"{ADMIN_BASE}/security-alerts/{alert['id']}", headers=h(STAFF), json={"action": "resolve"}
    )
    assert again.status_code == 409
    exit_again = (await http.post(f"{ADMIN_BASE}/exit-checks", json={"code": code}, headers=h(STAFF))).json()
    assert exit_again["result"] == "already_used" and exit_again["bagCheck"] is None


@integration
async def test_scanned_items_put_back_only_tell_the_shopper(
    api: Api, server: Server, http: httpx.AsyncClient, milk: Item, no_wait: None
) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    cart = await cart_code(api, auth, session_id)
    await api.add(auth, session_id, milk.code, 3)
    for _ in range(2):
        assert (await reading(server, http, cart, MILK_G)).json()["weightCheck"] == "missing"
    alerts = (await http.get(f"{ADMIN_BASE}/security-alerts", headers=h(STAFF))).json()["alerts"]
    assert not any(a["sessionId"] == session_id for a in alerts)


@integration
async def test_the_exit_gate_alerts_on_an_unpaid_cart_once(
    api: Api, server: Server, http: httpx.AsyncClient, milk: Item
) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    cart = await cart_code(api, auth, session_id)
    await api.add(auth, session_id, milk.code, 1)
    url = f"/hw/v1/stores/{STORE}/gates/G1/pass"
    key = {"x-device-key": server.guard.device_key(f"gate:{STORE}:G1")}
    assert (await http.post(url, json={"cartId": cart}, headers={"x-device-key": "nope"})).status_code == 401
    first = (await http.post(url, json={"cartId": cart}, headers=key)).json()
    second = (await http.post(url, json={"cartId": cart}, headers=key)).json()
    assert first["result"] == "alert" and second["alertId"] == first["alertId"]
    floor = (await http.get(f"/staff/v1/stores/{STORE}/security-alerts", headers=h(STAFF))).json()["alerts"]
    assert next(a for a in floor if a["id"] == first["alertId"])["kind"] == "exit_unpaid"
    false_alarm = await http.post(
        f"/staff/v1/stores/{STORE}/security-alerts/{first['alertId']}",
        headers=h(STAFF),
        json={"action": "false_alarm"},
    )
    assert false_alarm.json()["status"] == "false_alarm"

    free = await api.new_cart()
    assert (await http.post(url, json={"cartId": free}, headers=key)).json() == {
        "result": "ok",
        "alertId": None,
    }


@integration
async def test_fleet_shows_battery_faults_and_takes_carts_out_of_service(
    api: Api, server: Server, http: httpx.AsyncClient, milk: Item
) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    busy = await cart_code(api, auth, session_id)
    await reading(server, http, busy, 0, batteryPct=12, faults=["scale_error", "made_up"])
    fleet = (await http.get(f"{ADMIN_BASE}/fleet", headers=h(STAFF))).json()["carts"]
    row = next(c for c in fleet if c["cartId"] == busy)
    assert row["status"] == "in_use" and row["sessionId"] == session_id and row["batteryPct"] == 12
    assert row["faults"] == ["scale_error", "low_battery"] and row["aisle"] == "A1"
    assert (await http.get(f"{ADMIN_BASE}/fleet", headers=h(shopper()))).status_code == 403

    status = f"{ADMIN_BASE}/carts/{busy}/status"
    assert (await http.post(status, headers=h(STAFF), json={"status": "maintenance"})).status_code == 409

    free = await api.new_cart()
    out = await http.post(
        f"{ADMIN_BASE}/carts/{free}/status",
        headers=h(STAFF),
        json={"status": "maintenance", "reason": "Wobbly wheel"},
    )
    assert out.status_code == 200 and out.json()["status"] == "maintenance"
    paired = await api.pair(shopper(), free)
    assert paired.status_code == 409 and paired.json()["error"] == "cart_in_maintenance"
    back = await http.post(
        f"{ADMIN_BASE}/carts/{free}/status", headers=h(STAFF), json={"status": "available"}
    )
    assert back.json()["status"] == "available"
    assert (
        await http.post(f"{ADMIN_BASE}/carts/C-nope/status", headers=h(STAFF), json={"status": "available"})
    ).status_code == 404
    assert uuid.UUID(session_id)
