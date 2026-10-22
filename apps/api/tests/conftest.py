"""Integration tests run against a real Postgres and Redis with the seed loaded (docker compose or CI
services), through a real uvicorn server so REST and Socket.IO are exercised end to end.
They are skipped when DATABASE_URL or REDIS_URL is not set, so `pytest` works on a bare laptop."""

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
import uvicorn
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from smartcart.app import create_app
from smartcart.cart_service import CartService
from smartcart.config import Settings
from smartcart.models import Barcode, Cart, Inventory, Product
from smartcart.store_ops import StoreOps

STORE = "S-01"
STAFF = "Bearer dev:staff-demo"
ADMIN = "Bearer dev:admin-demo"


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if os.environ.get("DATABASE_URL") and os.environ.get("REDIS_URL"):
        return
    skip = pytest.mark.skip(reason="needs DATABASE_URL and REDIS_URL with the seed loaded")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)


@dataclass
class Server:
    url: str
    maker: async_sessionmaker[AsyncSession]
    redis: Redis
    carts: CartService
    ops: StoreOps


@pytest.fixture(scope="session")
async def server() -> AsyncIterator[Server]:
    settings = Settings(auth_mode="dev", cors_origins="")
    app = create_app(settings, run_sweeper=False)
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="on")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:  # noqa: ASYNC110 - uvicorn exposes only a flag
        await asyncio.sleep(0.05)
    port = srv.servers[0].sockets[0].getsockname()[1]
    state = app.other_asgi_app.state
    yield Server(f"http://127.0.0.1:{port}", state.sessionmaker, state.redis, state.carts, state.ops)
    srv.should_exit = True
    await task


@pytest.fixture(scope="session")
async def http(server: Server) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(base_url=server.url) as client:
        yield client


@dataclass(frozen=True)
class Item:
    code: str
    product_id: str


async def _find(maker: async_sessionmaker[AsyncSession], name: str) -> Item:
    async with maker() as db:
        row = (
            await db.execute(select(Barcode.code, Product.id).join(Product).where(Product.name == name))
        ).first()
        assert row, f"seed is missing {name}"
        return Item(code=row[0], product_id=row[1])


@pytest.fixture(scope="session")
async def milk(server: Server) -> Item:
    return await _find(server.maker, "Amul Toned Milk 500 ml")


@pytest.fixture(scope="session")
async def dal(server: Server) -> Item:
    return await _find(server.maker, "Tata Sampann Toor Dal 1 kg")


def shopper() -> str:
    return f"Bearer dev:t-{uuid.uuid4().hex[:8]}"


class Api:
    """Small helpers so each test makes its own cart and shopper and does not depend on the others."""

    def __init__(self, server: Server, http: httpx.AsyncClient) -> None:
        self.server, self.http = server, http

    async def new_cart(self) -> str:
        cart_id = f"C-9{uuid.uuid4().int % 10**6:06d}"
        async with self.server.maker() as db:
            db.add(Cart(id=cart_id, store_id=STORE, qr_code=f"smartcart://pair?cart={cart_id}&store={STORE}"))
            await db.commit()
        return cart_id

    async def pair(self, auth: str, cart_code: str) -> httpx.Response:
        return await self.http.post(
            "/v1/carts/pair", headers={"authorization": auth}, json={"cartCode": cart_code, "storeId": STORE}
        )

    async def session(self, auth: str) -> str:
        res = await self.pair(auth, await self.new_cart())
        assert res.status_code == 200, res.text
        return str(res.json()["sessionId"])

    async def add(
        self, auth: str, session_id: str, barcode: str, qty: int = 1, request_id: str | None = None
    ) -> httpx.Response:
        return await self.http.post(
            f"/v1/carts/{session_id}/items",
            headers={"authorization": auth},
            json={"barcode": barcode, "qty": qty, "requestId": request_id or str(uuid.uuid4())},
        )

    async def snapshot(self, auth: str, session_id: str) -> Any:
        res = await self.http.get(f"/v1/carts/{session_id}", headers={"authorization": auth})
        assert res.status_code == 200, res.text
        return res.json()

    async def reserved(self, product_id: str) -> int:
        async with self.server.maker() as db:
            inv = await db.get_one(Inventory, (STORE, product_id))
            return inv.reserved

    async def cart_status(self, cart_id: str) -> str:
        async with self.server.maker() as db:
            return (await db.get_one(Cart, cart_id)).status.value


@pytest.fixture
def api(server: Server, http: httpx.AsyncClient) -> Api:
    return Api(server, http)
