"""Milestone 4: search, smart list, floor help, insights and Ask SmartCart."""

import uuid

import httpx
import pytest

from smartcart.assist_service import aisle_key, pack_size, query_words, unit_price
from smartcart.assistant import rules_answer

from .conftest import STAFF, STORE, Api, Item, Server, shopper

BASE = f"/v1/stores/{STORE}"


# ---- Pure helpers (no database) ------------------------------------------------------------------


def test_query_words_drop_quantities_and_translate_hindi() -> None:
    assert query_words("2 kg Haldi") == ["turmeric"]
    assert query_words("doodh x2") == ["milk"]
    assert query_words("biscuits, 1 pack") == ["biscuit"]


def test_pack_size_and_unit_price() -> None:
    assert pack_size("Amul Toned Milk 500 ml") == (0.5, "L")
    assert pack_size("Lux Bathing Soap 100 g x 4") == (0.4, "kg")
    assert pack_size("Eggoz Farm Eggs 12 pcs") == (12, "pc")
    assert unit_price(2600, "Amul Toned Milk 500 ml") == (5200, "L")
    assert unit_price(2600, "Mystery item") == (None, None)


def test_aisles_sort_in_walking_order() -> None:
    aisles = [("B1", "2"), ("A3", "1"), (None, None), ("A1", "4"), ("A1", "1"), ("D2", "1")]
    assert sorted(aisles, key=lambda a: aisle_key(*a)) == [
        ("A1", "1"),
        ("A1", "4"),
        ("A3", "1"),
        ("B1", "2"),
        ("D2", "1"),
        (None, None),
    ]


def test_rules_answer_never_guesses() -> None:
    assert "won't guess" in rules_answer([])


# ---- Through the API -----------------------------------------------------------------------------

integration = pytest.mark.integration


@integration
async def test_search_finds_products_with_location_stock_and_unit_price(http: httpx.AsyncClient) -> None:
    res = await http.get(f"{BASE}/products/search", params={"q": "haldi"})
    assert res.status_code == 200
    results = res.json()["results"]
    assert results and all("Turmeric" in r["name"] for r in results)
    assert all(r["aisle"] and r["shelf"] and r["stock"] in {"in_stock", "low", "out"} for r in results)
    per_kg = [r["unitPricePaise"] for r in results]
    assert per_kg == sorted(per_kg) and {r["unit"] for r in results} == {"kg"}


@integration
async def test_search_filters_by_diet(http: httpx.AsyncClient) -> None:
    every = (await http.get(f"{BASE}/products/search", params={"q": "chips"})).json()["results"]
    jain = (await http.get(f"{BASE}/products/search", params={"q": "chips", "diet": "jain"})).json()[
        "results"
    ]
    assert every and jain == []
    veg = (await http.get(f"{BASE}/products/search", params={"q": "eggs", "diet": "veg"})).json()["results"]
    assert veg == []


@integration
async def test_search_rejects_an_empty_query(http: httpx.AsyncClient) -> None:
    assert (await http.get(f"{BASE}/products/search", params={"q": "  "})).status_code == 400


@integration
async def test_smart_list_becomes_a_walking_route(http: httpx.AsyncClient) -> None:
    unknown = f"dragonfruit {uuid.uuid4().hex[:6]}"
    res = await http.post(
        f"{BASE}/lists/route", json={"lines": ["shampoo", "2 kg atta", "doodh", unknown, "", "chai"]}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 5 and body["matched"] == 4 and body["notFound"] == [unknown]
    aisles = [stop["aisle"] for stop in body["stops"]]
    assert aisles == ["A1", "B1", "C1", "D1"]  # dairy, staples, tea, personal care: front to back
    milk = body["stops"][0]["items"][0]
    assert milk["line"] == "doodh" and "Milk" in milk["product"]["name"]
    assert milk["product"]["stock"] != "out"

    # A size on the line picks that pack, even when a smaller one is cheaper per kg.
    res = await http.post(f"{BASE}/lists/route", json={"lines": ["toor dal 1 kg", "toor dal"]})
    picks = [item["product"]["name"] for stop in res.json()["stops"] for item in stop["items"]]
    assert "Tata Sampann Toor Dal 1 kg" in picks and any(" 1 kg" not in name for name in picks)


@integration
async def test_missed_searches_show_up_in_insights(http: httpx.AsyncClient) -> None:
    missing = f"jeera {uuid.uuid4().hex[:6]}"
    await http.get(f"{BASE}/products/search", params={"q": missing})
    await http.get(f"{BASE}/products/search", params={"q": missing})
    assert (await http.get(f"/admin{BASE}/insights")).status_code == 401
    res = await http.get(f"/admin{BASE}/insights", headers={"authorization": STAFF})
    assert res.status_code == 200
    top = {m["query"]: m["count"] for m in res.json()["topMissed"]}
    assert top.get(missing) == 2
    assert res.json()["searches"] >= 2


@integration
async def test_floor_help_from_request_to_resolved(api: Api, http: httpx.AsyncClient, dal: Item) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    await api.add(auth, session_id, dal.code)

    res = await http.post(
        f"{BASE}/help", headers={"authorization": auth}, json={"topic": "find_item", "note": "jeera?"}
    )
    assert res.status_code == 201, res.text
    req = res.json()
    assert req["status"] == "open" and req["aisle"] == "B1" and req["cartId"]

    again = await http.post(f"{BASE}/help", headers={"authorization": auth}, json={"topic": "price"})
    assert again.json()["id"] == req["id"]  # one open request per shopper

    staff_view = await http.get(f"/admin{BASE}/help", headers={"authorization": STAFF})
    assert req["id"] in [r["id"] for r in staff_view.json()["requests"]]

    as_shopper = await http.post(
        f"{BASE}/help/{req['id']}", headers={"authorization": auth}, json={"action": "resolve"}
    )
    assert as_shopper.status_code == 400

    for action, status in (("acknowledge", "acknowledged"), ("resolve", "resolved")):
        res = await http.post(
            f"/admin{BASE}/help/{req['id']}", headers={"authorization": STAFF}, json={"action": action}
        )
        assert res.status_code == 200 and res.json()["status"] == status

    mine = await http.get(f"{BASE}/help/mine", headers={"authorization": auth})
    assert mine.json()["request"]["status"] == "resolved"
    closed = await http.post(
        f"{BASE}/help/{req['id']}", headers={"authorization": auth}, json={"action": "cancel"}
    )
    assert closed.status_code == 409


@integration
async def test_shopper_can_cancel_help_without_a_cart(http: httpx.AsyncClient) -> None:
    auth = shopper()
    req = (await http.post(f"{BASE}/help", headers={"authorization": auth}, json={})).json()
    assert req["aisle"] is None and req["cartId"] is None
    other = await http.post(
        f"{BASE}/help/{req['id']}", headers={"authorization": shopper()}, json={"action": "cancel"}
    )
    assert other.status_code == 404
    res = await http.post(
        f"{BASE}/help/{req['id']}", headers={"authorization": auth}, json={"action": "cancel"}
    )
    assert res.json()["status"] == "cancelled"


@integration
async def test_assistant_answers_from_store_facts_without_ai(http: httpx.AsyncClient) -> None:
    assert (await http.post(f"{BASE}/assistant", json={"message": "hi"})).status_code == 401
    auth = shopper()
    res = await http.post(
        f"{BASE}/assistant", headers={"authorization": auth}, json={"message": "Where is the paneer?"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mode"] == "rules"
    assert body["products"] and all("Paneer" in p["name"] for p in body["products"])
    assert "aisle A1" in body["reply"]

    nothing = await http.post(
        f"{BASE}/assistant", headers={"authorization": auth}, json={"message": "Do you sell iPhones?"}
    )
    assert nothing.json()["products"] == [] and "won't guess" in nothing.json()["reply"]


@integration
async def test_assistant_gives_the_model_only_store_facts(server: Server, http: httpx.AsyncClient) -> None:
    from smartcart.assistant import Assistant

    seen: list[str] = []

    async def fake_model(prompt: str, turns: list[dict[str, str]]) -> str:
        seen.append(prompt)
        return "Paneer is in aisle A1."

    async with server.maker() as db:
        app_assistant = Assistant(_assist_service(http), api_key=None, complete=fake_model)
        body = await app_assistant.answer(db, STORE, "paneer kahan milega?", [])
    assert body == body | {"mode": "ai", "reply": "Paneer is in aisle A1."}
    assert "STORE FACTS" in seen[0] and "Amul Fresh Paneer 200 g" in seen[0]
    assert "Toned Milk" not in seen[0]


def _assist_service(_: httpx.AsyncClient):  # type: ignore[no-untyped-def]
    from smartcart.assist_service import AssistService

    async def publish(*_: object) -> None:
        return None

    return AssistService(publish)
