"""A stand-in for cart hardware until the real carts exist (V2 sends the same readings through AWS
IoT Core). It reads what is scanned into a cart, weighs it like the load cell would, and sends a
reading every few seconds, signed with the cart's device key.

    python -m smartcart.cart_sim C-0007                 # a cart whose weight matches its scans
    python -m smartcart.cart_sim C-0007 --extra 450     # plus 450 g that was never scanned
    python -m smartcart.cart_sim C-0007 --gate G1       # then roll it through exit gate G1
    python -m smartcart.cart_sim --key C-0007           # print a cart's device key

Run it next to the API (it needs the same DATABASE_URL, REDIS_URL and CART_DEVICE_SECRET).
"""

import argparse
import asyncio
import random

import httpx
from redis.asyncio import Redis
from sqlalchemy import select

from .cart_guard import CartGuard
from .cart_service import OPEN, CartService
from .config import get_settings
from .db import make_engine, make_sessionmaker
from .models import Cart, CartEvent, CartSession, Inventory, Product


async def _noop(*_: object) -> None:
    return None


async def run(cart_id: str, api: str, extra_g: int, every: float, readings: int, gate: str | None) -> None:
    settings = get_settings()
    engine = make_engine(settings.async_database_url)
    maker = make_sessionmaker(engine)
    redis = Redis.from_url(settings.redis_url)
    carts = CartService(redis, _noop)
    guard = CartGuard(carts, _noop, settings.device_secret)
    battery = random.randint(55, 100)
    try:
        async with httpx.AsyncClient(base_url=api, timeout=10) as http:
            for n in range(readings):
                async with maker() as db:
                    cart = await db.get_one(Cart, cart_id)
                    session = await db.scalar(
                        select(CartSession).where(
                            CartSession.cart_id == cart_id, CartSession.status.in_(OPEN)
                        )
                    )
                    weight, aisle = 0, None
                    if session:
                        qty = await carts.quantities(db, session)
                        for pid, q in qty.items():
                            weight += ((await db.get_one(Product, pid)).weight_g or 0) * q
                        aisle = await db.scalar(
                            select(Inventory.aisle)
                            .join(CartEvent, CartEvent.product_id == Inventory.product_id)
                            .where(CartEvent.session_id == session.id, Inventory.store_id == cart.store_id)
                            .order_by(CartEvent.at.desc())
                            .limit(1)
                        )
                        weight += extra_g
                body = {
                    "batteryPct": max(0, battery - n // 20),
                    "weightG": weight + random.randint(-15, 15),
                    "aisle": aisle,
                }
                res = await http.post(
                    f"/hw/v1/carts/{cart_id}/telemetry",
                    json=body,
                    headers={"x-device-key": guard.device_key(f"cart:{cart_id}")},
                )
                print(cart_id, body, "->", res.json())
                await asyncio.sleep(every)
            if gate:
                res = await http.post(
                    f"/hw/v1/stores/{cart.store_id}/gates/{gate}/pass",
                    json={"cartId": cart_id},
                    headers={"x-device-key": guard.device_key(f"gate:{cart.store_id}:{gate}")},
                )
                print("gate", gate, "->", res.json())
    finally:
        await redis.aclose()
        await engine.dispose()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("cart", help="cart code, e.g. C-0007")
    p.add_argument("--api", default="http://localhost:4000")
    p.add_argument("--extra", type=int, default=0, help="grams in the basket that were never scanned")
    p.add_argument("--every", type=float, default=5.0, help="seconds between readings")
    p.add_argument("--readings", type=int, default=20)
    p.add_argument("--gate", help="roll the cart through this exit gate at the end")
    p.add_argument("--key", action="store_true", help="only print the cart's device key")
    args = p.parse_args()
    if args.key:
        print(CartGuard(None, _noop, get_settings().device_secret).device_key(f"cart:{args.cart}"))  # type: ignore[arg-type]
        return
    asyncio.run(run(args.cart, args.api, args.extra, args.every, args.readings, args.gate))


if __name__ == "__main__":
    main()
