import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest
import socketio

from .conftest import STAFF, STORE, Api, Item, Server, shopper

pytestmark = pytest.mark.integration


class Listener:
    """A Socket.IO client that queues every "event" it receives so tests can wait for a type."""

    def __init__(self) -> None:
        self.client = socketio.AsyncClient(reconnection=False)
        self.events: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.client.on("event", self.events.put)

    async def next(self, type_: str) -> dict[str, Any]:
        async with asyncio.timeout(5):
            while True:
                evt = await self.events.get()
                if evt["type"] == type_:
                    return evt

    async def join(self, **payload: str) -> Any:
        return await self.client.call("join", payload, timeout=5)


@asynccontextmanager
async def connected(server: Server, auth: str) -> AsyncIterator[Listener]:
    listener = Listener()
    await listener.client.connect(
        server.url, auth={"token": auth.removeprefix("Bearer ")}, transports=["websocket"], wait_timeout=5
    )
    try:
        yield listener
    finally:
        await listener.client.disconnect()


async def test_rejects_a_socket_without_a_valid_token(server: Server) -> None:
    client = socketio.AsyncClient(reconnection=False)
    refused: list[Any] = []
    client.on("connect_error", refused.append)
    with pytest.raises(socketio.exceptions.ConnectionError):
        await client.connect(server.url, auth={"token": "nope"}, transports=["websocket"], wait_timeout=5)
    assert refused == [{"message": "unauthenticated"}]


async def test_snapshot_on_join_then_adds_reach_the_shopper_and_the_store(
    server: Server, api: Api, milk: Item
) -> None:
    auth = shopper()
    session_id = await api.session(auth)
    async with connected(server, auth) as phone, connected(server, STAFF) as staff:
        assert await phone.join(room="cart", sessionId=session_id) == {"ok": True}
        assert (await phone.next("cart.snapshot"))["data"]["sessionId"] == session_id
        assert await staff.join(room="store", storeId=STORE) == {"ok": True}

        await api.add(auth, session_id, milk.code, 2)
        on_phone = await phone.next("cart.item_added")
        assert on_phone["source"] == "phone"
        assert on_phone["data"]["line"]["qty"] == 2
        assert (await staff.next("cart.item_added"))["eventId"] == on_phone["eventId"]
        assert (await staff.next("inventory.updated"))["storeId"] == STORE


async def test_keeps_shoppers_out_of_other_carts_and_the_store_room(server: Server, api: Api) -> None:
    session_id = await api.session(shopper())
    async with connected(server, shopper()) as intruder:
        assert await intruder.join(room="cart", sessionId=session_id) == {"ok": False, "error": "not_found"}
        assert await intruder.join(room="store", storeId=STORE) == {"ok": False, "error": "forbidden"}
