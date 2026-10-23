"""Milestone 7: store analytics, computed in Python from what the store recorded."""

from datetime import datetime, timedelta

import httpx
import pytest

from smartcart.analytics import Activity, OfferWindow, PaidOrder, Sale, compute

from .conftest import STAFF, STORE, Api, Item, shopper
from .test_contracts import check

UNTIL = datetime(2026, 10, 23, 12, 0)  # 17:30 IST


def order(n: int, hours_ago: float, *lines: Sale, minutes: float = 20) -> PaidOrder:
    paid = UNTIL - timedelta(hours=hours_ago)
    total = sum(s.qty * s.unit_paise for s in lines)
    return PaidOrder(f"o{n}", paid - timedelta(minutes=minutes), paid, total, lines)


def sale(product: str, qty: int, unit: int, regular: int | None = None, section: str = "Staples") -> Sale:
    return Sale(product, product.title(), section, qty, unit, regular or unit)


def test_sales_are_bucketed_by_ist_hour_and_day() -> None:
    orders = [
        order(1, 1, sale("atta", 1, 30000)),  # 16:30 IST today
        order(2, 1.2, sale("milk", 2, 2600, section="Dairy and eggs"), minutes=10),
        order(3, 30, sale("atta", 1, 30000), minutes=30),  # yesterday 11:30 IST
        order(4, 24 * 9, sale("atta", 5, 30000)),  # before the window
    ]
    out = compute("S-01", 7, UNTIL, orders, [], Activity())
    assert out["summary"] == {
        "orders": 3,
        "revenuePaise": 65200,
        "avgBasketPaise": 21733,
        "avgItems": 1.3,
        "medianMinutesToPay": 20.0,
    }
    assert len(out["byHour"]) == 24 and out["byHour"][16]["orders"] == 2 and out["byHour"][11]["orders"] == 1
    days = {d["date"]: d["orders"] for d in out["byDay"]}
    assert days["2026-10-23"] == 2 and days["2026-10-22"] == 1 and len(days) == 8
    assert [p["productId"] for p in out["topProducts"]] == ["atta", "milk"]
    assert out["categoryMix"][0] == {"section": "Staples", "revenuePaise": 60000, "share": 0.92}


def test_deal_uplift_compares_with_the_days_before_and_never_guesses() -> None:
    start = UNTIL - timedelta(days=4)
    tea = OfferWindow("of1", "tea", "Tea", "Tea week", 8500, start, start + timedelta(days=2))
    before = [order(10 + i, 24 * 5 + i, sale("tea", 1, 10000)) for i in range(5)]  # 5 units before
    during = [order(20 + i, 24 * 3 + i, sale("tea", 3, 8500, regular=10000)) for i in range(5)]  # 15 during
    out = compute("S-01", 7, UNTIL, before + during, [tea], Activity())
    deals = out["deals"]
    assert deals["ordersWithDeal"] == 5 and deals["dealUnits"] == 15 and deals["savingsPaise"] == 15 * 1500
    (up,) = deals["offers"]
    assert (up["unitsBefore"], up["unitsDuring"], up["upliftPct"], up["running"]) == (5, 15, 200, False)

    # No sales at all before the offer, or too few to compare: say nothing rather than claim an uplift.
    alone = compute("S-01", 7, UNTIL, during, [tea], Activity())["deals"]["offers"][0]
    assert alone["unitsBefore"] is None and alone["upliftPct"] is None
    few = compute("S-01", 7, UNTIL, before[:2] + during, [tea], Activity())["deals"]["offers"][0]
    assert few["unitsBefore"] == 2 and few["upliftPct"] is None


def test_aisles_searches_and_alerts() -> None:
    activity = Activity(
        scans=["A1", "A1", "B2", "C1", "A1"],
        help_aisles=["B2", "B2", None, "D1"],
        searches=[("voice", 3), ("search", 0), ("search", 4), ("list", 2)],
        alerts=[("unscanned_item", "cleared"), ("unscanned_item", "resolved"), ("exit_unpaid", "open")],
    )
    out = compute("S-01", 7, UNTIL, [], [], activity)
    assert out["busyAisles"][:2] == [
        {"aisle": "A1", "scans": 3, "helpRequests": 0},
        {"aisle": "B2", "scans": 1, "helpRequests": 2},
    ]
    assert out["searches"] == {"total": 4, "voice": 1, "voiceShare": 0.25, "missed": 1}
    assert out["security"]["clearedByShopper"] == 1 and out["security"]["open"] == 1
    assert out["summary"]["avgBasketPaise"] is None and out["deals"]["dealShare"] is None


@pytest.mark.integration
async def test_the_analytics_page_counts_a_new_order(api: Api, http: httpx.AsyncClient, milk: Item) -> None:
    url = f"/admin/v1/stores/{STORE}/analytics"
    staff = {"authorization": STAFF}
    assert (await http.get(url, headers={"authorization": shopper()})).status_code == 403
    assert (await http.get(url, params={"days": 0}, headers=staff)).status_code == 400
    before = (await http.get(url, params={"days": 1}, headers=staff)).json()
    check("StoreAnalytics", before)

    auth = shopper()
    session_id = await api.session(auth)
    await api.add(auth, session_id, milk.code, 2)
    order_id = (await http.post(f"/v1/carts/{session_id}/checkout", headers={"authorization": auth})).json()[
        "order"
    ]["orderId"]
    await http.post(f"/v1/orders/{order_id}/pay/fake", headers={"authorization": auth})

    after = (await http.get(url, params={"days": 1}, headers=staff)).json()
    check("StoreAnalytics", after)
    assert after["summary"]["orders"] == before["summary"]["orders"] + 1
    assert after["summary"]["revenuePaise"] > before["summary"]["revenuePaise"]
    assert sum(a["scans"] for a in after["busyAisles"]) >= sum(a["scans"] for a in before["busyAisles"])
