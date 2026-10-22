"""Socket.IO gateway.

Clients authenticate in the handshake (auth.token, the same bearer token as REST), then ask to join
a room:
  {"room": "cart", "sessionId": ...}  the shopper's own cart; answered with a cart.snapshot event
  {"room": "store", "storeId": ...}   staff only; store-wide events for the dashboard
Every server-to-client message is emitted as "event" in the shared envelope.
"""

import uuid
from typing import Any

import socketio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .auth import AuthError, TokenVerifier, is_staff, upsert_user
from .cart_service import CartService
from .errors import ApiError
from .schemas import cart_room, event, store_room


class Realtime:
    def __init__(self, cors_origins: list[str], redis_url: str | None) -> None:
        manager = socketio.AsyncRedisManager(redis_url) if redis_url else None
        self.sio = socketio.AsyncServer(
            async_mode="asgi",
            cors_allowed_origins=cors_origins or [],
            client_manager=manager,
        )

    async def publish(self, evt: dict[str, Any], rooms: list[str]) -> None:
        await self.sio.emit("event", evt, to=rooms)

    def attach(
        self,
        verifier: TokenVerifier,
        maker: async_sessionmaker[AsyncSession],
        carts: CartService,
    ) -> None:
        sio = self.sio

        @sio.event
        async def connect(sid: str, environ: dict[str, Any], auth: dict[str, Any] | None) -> None:
            token = (auth or {}).get("token")
            try:
                if not isinstance(token, str):
                    raise AuthError("missing token")
                identity = await verifier.verify(token)
            except AuthError as err:
                raise socketio.exceptions.ConnectionRefusedError("unauthenticated") from err
            async with maker() as db:
                user = await upsert_user(db, identity)
            await sio.save_session(sid, {"user_id": user.id})

        @sio.event
        async def join(sid: str, data: Any) -> dict[str, Any]:
            user_id: str = (await sio.get_session(sid))["user_id"]
            if not isinstance(data, dict):
                return {"ok": False, "error": "invalid_request"}
            room = data.get("room")
            async with maker() as db:
                if room == "cart" and _is_uuid(data.get("sessionId")):
                    try:
                        session = await carts.owned_session(db, data["sessionId"], user_id)
                    except ApiError:
                        return {"ok": False, "error": "not_found"}
                    await sio.enter_room(sid, cart_room(session.id))
                    # A fresh snapshot on every join is how a reconnecting app resynchronises.
                    snap = await carts.snapshot(db, session)
                    await sio.emit(
                        "event",
                        event(
                            "cart.snapshot",
                            store_id=snap.store_id,
                            cart_id=snap.cart_code,
                            source="system",
                            data=snap.wire(),
                        ),
                        to=sid,
                    )
                    return {"ok": True}
                if room == "store" and isinstance(data.get("storeId"), str):
                    if not await is_staff(db, user_id, data["storeId"]):
                        return {"ok": False, "error": "forbidden"}
                    await sio.enter_room(sid, store_room(data["storeId"]))
                    return {"ok": True}
            return {"ok": False, "error": "invalid_request"}


def _is_uuid(v: Any) -> bool:
    try:
        uuid.UUID(str(v))
        return True
    except ValueError:
        return False
