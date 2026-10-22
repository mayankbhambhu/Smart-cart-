import httpx
import pytest

from .conftest import STAFF

pytestmark = pytest.mark.integration


async def test_ready_when_postgres_and_redis_answer(http: httpx.AsyncClient) -> None:
    res = await http.get("/readyz")
    assert res.status_code == 200
    assert res.json()["checks"] == {"postgres": "ok", "redis": "ok"}


async def test_looks_up_a_seeded_product_with_its_store_price(http: httpx.AsyncClient) -> None:
    res = await http.get("/v1/products/barcode/2000000000015", params={"storeId": "S-01"})
    assert res.status_code == 200
    body = res.json()
    assert body["barcode"] == "2000000000015"
    assert 0 < body["pricePaise"] <= body["mrpPaise"]


async def test_unknown_barcode_is_404(http: httpx.AsyncClient) -> None:
    assert (await http.get("/v1/products/barcode/2999999999999")).status_code == 404


async def test_store_inventory_is_for_staff_only(http: httpx.AsyncClient) -> None:
    assert (await http.get("/admin/v1/stores/S-01/inventory")).status_code == 401
    shopper = await http.get(
        "/admin/v1/stores/S-01/inventory", headers={"authorization": "Bearer dev:not-staff"}
    )
    assert shopper.status_code == 403


async def test_lists_inventory_and_filters_low_stock(http: httpx.AsyncClient) -> None:
    headers = {"authorization": STAFF}
    everything = (await http.get("/admin/v1/stores/S-01/inventory", headers=headers)).json()["items"]
    assert len(everything) >= 150
    not_filtered = await http.get("/admin/v1/stores/S-01/inventory?lowStockOnly=false", headers=headers)
    assert len(not_filtered.json()["items"]) == len(everything)
    low = (await http.get("/admin/v1/stores/S-01/inventory?lowStockOnly=true", headers=headers)).json()[
        "items"
    ]
    assert 0 < len(low) < len(everything)
    assert all(i["available"] <= i["lowStockThreshold"] for i in low)
