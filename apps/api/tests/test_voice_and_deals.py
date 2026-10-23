"""Milestone 6: voice search in Hindi and English (US-02) and manager-run aisle deals (US-08)."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from smartcart.assist_service import query_words

from .conftest import STAFF, STORE, Api, Item, Server, _find, shopper

BASE = f"/v1/stores/{STORE}"
ADMIN_BASE = f"/admin/v1/stores/{STORE}"
# Not used by other tests, so its price can change here without breaking them.
DEAL_PRODUCT = "Parle-G Biscuits 250 g"
DEAL_REGULAR = 2800


def h(auth: str) -> dict[str, str]:
    return {"authorization": auth}


def in_days(days: float) -> str:
    return (datetime.now(UTC) + timedelta(days=days)).isoformat()


def test_spoken_questions_reduce_to_item_words() -> None:
    assert query_words("haldi kahan milega?") == ["turmeric"]
    assert query_words("मुझे चीनी चाहिए") == ["sugar"]
    assert query_words("दूध कहाँ है।") == ["milk"]
    assert query_words("Where is the toor dal") == ["toor", "dal"]
    assert query_words("I need Maggi please") == ["maggi"]


integration = pytest.mark.integration


@integration
async def test_voice_search_answers_hindi_and_counts_in_the_report(http: httpx.AsyncClient) -> None:
    before = (await http.get(f"{ADMIN_BASE}/insights", headers=h(STAFF))).json()["voiceSearches"]
    for q in ("haldi kahan milega", "हल्दी कहाँ है"):
        res = await http.get(f"{BASE}/products/search", params={"q": q, "source": "voice"})
        assert res.status_code == 200
        results = res.json()["results"]
        assert results and all("Turmeric" in r["name"] and r["aisle"] and r["shelf"] for r in results)
    after = (await http.get(f"{ADMIN_BASE}/insights", headers=h(STAFF))).json()["voiceSearches"]
    assert after == before + 2
    ghee = (
        await http.get(f"{BASE}/products/search", params={"q": "where is the ghee", "source": "voice"})
    ).json()
    assert "Ghee" in ghee["results"][0]["name"], "named products before the rest of Oils and ghee"
    bad = await http.get(f"{BASE}/products/search", params={"q": "milk", "source": "robot"})
    assert bad.status_code == 400


@integration
async def test_shoppers_see_running_deals_by_aisle_and_diet(http: httpx.AsyncClient) -> None:
    offers = (await http.get(f"{BASE}/offers")).json()["offers"]
    assert len(offers) >= 8, "seed has demo offers"
    for o in offers:
        assert 0 < o["offerPricePaise"] < o["regularPaise"]
        assert o["savingsPaise"] == o["regularPaise"] - o["offerPricePaise"]
    aisles = [o["aisle"] for o in offers]
    assert aisles == sorted(aisles, key=lambda a: (a[0], int(a[1:]))), "walking order"

    a2 = (await http.get(f"{BASE}/offers", params={"aisle": "a2"})).json()["offers"]
    assert a2 and all(o["aisle"] == "A2" for o in a2)
    assert any(o["foodType"] == "egg" for o in a2)
    veg = (await http.get(f"{BASE}/offers", params={"aisle": "A2", "diet": "veg"})).json()["offers"]
    assert veg and all(o["foodType"] == "veg" for o in veg), "a vegetarian isn't told about eggs"


@integration
async def test_a_managers_offer_prices_search_and_cart_until_it_ends(
    http: httpx.AsyncClient, api: Api, server: Server
) -> None:
    item: Item = await _find(server.maker, DEAL_PRODUCT)
    for o in (await http.get(f"{ADMIN_BASE}/offers", headers=h(STAFF))).json()["offers"]:
        if o["productId"] == item.product_id and o["status"] != "ended":  # left over from an earlier run
            await http.post(f"{ADMIN_BASE}/offers/{o['id']}/end", headers=h(STAFF))

    body = {
        "productId": item.product_id,
        "title": "Biscuit deal",
        "offerPricePaise": 2500,
        "endsAt": in_days(3),
    }
    assert (await http.post(f"{ADMIN_BASE}/offers", headers=h(shopper()), json=body)).status_code == 403
    created = await http.post(f"{ADMIN_BASE}/offers", headers=h(STAFF), json=body)
    assert created.status_code == 201, created.text
    offer = created.json()
    assert offer["status"] == "running" and offer["regularPaise"] == DEAL_REGULAR

    again = await http.post(f"{ADMIN_BASE}/offers", headers=h(STAFF), json={**body, "offerPricePaise": 2400})
    assert again.status_code == 409 and again.json()["error"] == "offer_exists"

    found = (await http.get(f"{BASE}/products/search", params={"q": "parle-g 250"})).json()["results"]
    hit = next(r for r in found if r["productId"] == item.product_id)
    assert hit["pricePaise"] == 2500
    assert hit["offer"]["title"] == "Biscuit deal" and hit["offer"]["regularPaise"] == DEAL_REGULAR
    assert any(o["id"] == offer["id"] for o in (await http.get(f"{BASE}/offers")).json()["offers"])

    auth = shopper()
    session_id = await api.session(auth)
    assert (await api.add(auth, session_id, item.code)).status_code == 200
    line = next(
        li for li in (await api.snapshot(auth, session_id))["lines"] if li["productId"] == item.product_id
    )
    assert line["unitPricePaise"] == 2500

    ended = await http.post(f"{ADMIN_BASE}/offers/{offer['id']}/end", headers=h(STAFF))
    assert ended.status_code == 200 and ended.json()["status"] == "ended"
    assert (await http.post(f"{ADMIN_BASE}/offers/{offer['id']}/end", headers=h(STAFF))).status_code == 409
    found = (await http.get(f"{BASE}/products/search", params={"q": "parle-g 250"})).json()["results"]
    hit = next(r for r in found if r["productId"] == item.product_id)
    assert hit["pricePaise"] == DEAL_REGULAR and hit["offer"] is None
    listed = (await http.get(f"{ADMIN_BASE}/offers", headers=h(STAFF))).json()["offers"]
    assert next(o for o in listed if o["id"] == offer["id"])["status"] == "ended"


@integration
async def test_offers_must_lower_the_price_within_a_month(http: httpx.AsyncClient, server: Server) -> None:
    item = await _find(server.maker, DEAL_PRODUCT)
    post = f"{ADMIN_BASE}/offers"
    base = {"productId": item.product_id, "title": "Bad deal", "endsAt": in_days(2)}
    higher = await http.post(post, headers=h(STAFF), json={**base, "offerPricePaise": DEAL_REGULAR})
    assert higher.status_code == 400 and higher.json()["error"] == "offer_price_not_lower"
    long = await http.post(
        post, headers=h(STAFF), json={**base, "offerPricePaise": 2000, "endsAt": in_days(40)}
    )
    assert long.status_code == 400 and long.json()["error"] == "invalid_offer_window"
    past = await http.post(
        post, headers=h(STAFF), json={**base, "offerPricePaise": 2000, "endsAt": in_days(-1)}
    )
    assert past.status_code == 400
    missing = await http.post(
        post, headers=h(STAFF), json={**base, "productId": "nope", "offerPricePaise": 1}
    )
    assert missing.status_code == 404
