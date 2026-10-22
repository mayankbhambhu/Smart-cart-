"""The API must speak the shared contract in packages/contracts, which the app and dashboard are built on.
Validates real responses and pushed events against the exported JSON Schemas."""

import json
import uuid
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from .conftest import Api, Item, Server, shopper
from .test_realtime import connected

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
