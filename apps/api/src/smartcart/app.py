"""Builds the ASGI app: FastAPI for REST plus the Socket.IO gateway on /socket.io."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from typing import Any

import socketio
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

from .auth import DevTokenVerifier, FirebaseTokenVerifier, TokenVerifier
from .cart_service import CartService
from .checkout_service import CheckoutService
from .config import Settings, get_settings
from .db import make_engine, make_sessionmaker
from .errors import ApiError
from .payments import make_provider
from .realtime import Realtime
from .routes import admin, carts, catalog, health, orders

log = logging.getLogger("smartcart")


def make_verifier(settings: Settings) -> TokenVerifier:
    if settings.auth_mode == "firebase":
        assert settings.firebase_project_id
        return FirebaseTokenVerifier(settings.firebase_project_id)
    return DevTokenVerifier()


def create_app(settings: Settings | None = None, *, run_sweeper: bool = True) -> Any:
    settings = settings or get_settings()
    engine = make_engine(settings.async_database_url)
    maker = make_sessionmaker(engine)
    redis = Redis.from_url(settings.redis_url)
    verifier = make_verifier(settings)
    realtime = Realtime(settings.cors_origin_list, settings.redis_url if settings.realtime_redis else None)
    cart_service = CartService(redis, realtime.publish)
    checkout = CheckoutService(cart_service, make_provider(settings), realtime.publish)
    realtime.attach(verifier, maker, cart_service)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if settings.auth_mode == "dev":
            log.warning("AUTH_MODE=dev: bearer tokens are not verified")
        if settings.payment_provider == "fake":
            log.warning("PAYMENT_PROVIDER=fake: orders are paid without taking money")

        async def sweep() -> None:
            # Abandon idle carts so their stock reservations are released. Safe on every instance.
            while True:
                await asyncio.sleep(60)
                try:
                    # Carts left at the payment screen go back to shopping first, then idle carts close.
                    await checkout.expire_stale(maker, settings.cart_idle_minutes)
                    n = await cart_service.sweep_idle(maker, settings.cart_idle_minutes)
                    if n:
                        log.info("abandoned %d idle cart sessions", n)
                except Exception:
                    log.exception("idle cart sweep failed")

        task = asyncio.create_task(sweep()) if run_sweeper else None
        yield
        if task:
            task.cancel()
        await redis.aclose()
        await engine.dispose()

    api = FastAPI(title="Smart Cart API", version="0.2.0", lifespan=lifespan)
    api.state.settings = settings
    api.state.sessionmaker = maker
    api.state.redis = redis
    api.state.verifier = verifier
    api.state.carts = cart_service
    api.state.checkout = checkout
    api.state.realtime = realtime
    api.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @api.exception_handler(ApiError)
    async def api_error(_: Request, err: ApiError) -> JSONResponse:
        return JSONResponse({"error": err.code, **err.details}, status_code=err.status)

    @api.exception_handler(RequestValidationError)
    async def invalid(_: Request, err: RequestValidationError) -> JSONResponse:
        return JSONResponse({"error": "invalid_request", "issues": err.errors()}, status_code=400)

    # Module boundaries follow docs/architecture.md: each module owns its tables.
    for r in (health.router, catalog.router, carts.router, orders.router, admin.router):
        api.include_router(r)

    return socketio.ASGIApp(realtime.sio, other_asgi_app=api)
