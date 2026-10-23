"""Milestone 7 pilot hardening: rate limits, request ids and structured logs."""

import json
import logging
import re
import uuid
from collections.abc import Iterator

import httpx
import pytest

from smartcart.hardening import JsonFormatter, Rule, default_rules, request_id

from .conftest import STORE, Server


def test_limits_scale_and_cover_the_abusable_routes() -> None:
    rules = {r.name: r for r in default_rules()}
    assert rules["staff_login"].by == "ip" and rules["staff_login"].limit == 10
    assert rules["assistant"].path.search(f"/v1/stores/{STORE}/assistant")
    assert rules["hardware"].path.search("/hw/v1/carts/C-0001/telemetry")
    assert {r.name: r.limit for r in default_rules(2)}["search"] == 240


def test_json_logs_carry_the_request_id() -> None:
    record = logging.LogRecord("smartcart.access", logging.INFO, __file__, 1, "GET /x 200", None, None)
    record.status = 200
    token = request_id.set("abc12345")
    try:
        out = json.loads(JsonFormatter().format(record))
    finally:
        request_id.reset(token)
    assert out["requestId"] == "abc12345" and out["status"] == 200 and out["level"] == "info"


@pytest.fixture
def limits_on(server: Server) -> Iterator[None]:
    # A tiny limit on a route other tests don't use this way, with a unique path per run.
    before = server.limiter.rules, server.limiter.enabled
    server.limiter.rules = [Rule("test_search", "GET", re.compile(r"^/v1/stores/[^/]+/products/search$"), 3)]
    server.limiter.enabled = True
    yield
    server.limiter.rules, server.limiter.enabled = before


@pytest.mark.integration
async def test_a_caller_over_the_limit_gets_429_and_others_do_not(
    http: httpx.AsyncClient, limits_on: None
) -> None:
    url = f"/v1/stores/{STORE}/products/search"
    me = {"authorization": f"Bearer dev:limit-{uuid.uuid4()}"}
    codes = [(await http.get(url, params={"q": "milk"}, headers=me)).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    over = await http.get(url, params={"q": "milk"}, headers=me)
    assert over.json()["error"] == "rate_limited" and int(over.headers["retry-after"]) >= 1
    other = {"authorization": f"Bearer dev:limit-{uuid.uuid4()}"}
    assert (await http.get(url, params={"q": "milk"}, headers=other)).status_code == 200
    # Routes without a rule are never limited.
    assert (await http.get("/v1/sections", headers=me)).status_code == 200


@pytest.mark.integration
async def test_every_response_has_a_request_id(http: httpx.AsyncClient) -> None:
    res = await http.get("/v1/sections")
    assert re.fullmatch(r"[0-9a-f]{32}", res.headers["x-request-id"])
    mine = await http.get("/v1/sections", headers={"x-request-id": "door-scan-0001"})
    assert mine.headers["x-request-id"] == "door-scan-0001"
    junk = await http.get("/v1/sections", headers={"x-request-id": "<script>"})
    assert junk.headers["x-request-id"] != "<script>"


def test_error_tracking_is_off_without_a_dsn_and_strips_secrets_when_on() -> None:
    import sentry_sdk

    from smartcart.hardening import init_error_tracking

    assert init_error_tracking(None, "test", "0") is False
    assert init_error_tracking("https://key@sentry.invalid/1", "test", "0") is True
    try:
        scrub = sentry_sdk.get_client().options["before_send"]
        event = {
            "request": {
                "data": {"password": "x"},
                "cookies": {"a": "b"},
                "headers": {"Authorization": "Bearer t", "X-Device-Key": "k", "Accept": "*/*"},
            }
        }
        out = scrub(event, {})
        assert "data" not in out["request"] and "cookies" not in out["request"]
        assert out["request"]["headers"] == {
            "Authorization": "[removed]",
            "X-Device-Key": "[removed]",
            "Accept": "*/*",
        }
    finally:
        sentry_sdk.init()  # off again for the rest of the suite
