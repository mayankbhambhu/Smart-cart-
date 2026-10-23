"""Sample trading history for the pilot store, so the Analytics page has weeks to show in a demo.

    uv run python -m smartcart.seed_history --days 14

Adds paid orders with their cart events, searches, help requests, security alerts and one past
"Tea week" offer, spread over store hours the way a DMart day runs (busy late morning and evening,
busier at weekends). Every row hangs off shoppers whose sign-in id starts with "history:", and a
re-run replaces them, so it never piles up. It is sample data: never run it against a live store.
"""

import argparse
import asyncio
import random
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .analytics import IST
from .config import get_settings
from .db import make_engine, make_sessionmaker
from .models import (
    CartEvent,
    CartSession,
    CartSessionStatus,
    EventSource,
    HelpRequest,
    HelpStatus,
    Inventory,
    Offer,
    Order,
    OrderItem,
    OrderStatus,
    Product,
    SearchLog,
    SecurityAlert,
    StorePrice,
    User,
    utcnow,
)
from .money import gst_included_paise
from .seed import CART_COUNT, STORE_ID

PREFIX = "history:"
SHOPPERS = [
    "Asha Patil", "Rohan Mehta", "Meera Iyer", "Kabir Shah", "Ananya Rao", "Vikram Nair", "Priya Desai",
    "Arjun Kulkarni", "Sneha Joshi", "Farhan Qureshi", "Divya Menon", "Rahul Gupta", "Kavya Reddy",
    "Siddharth Jain", "Neha Bhatt", "Imran Sheikh", "Pooja Pillai", "Aditya Rane", "Lata Gokhale",
    "Manish Agarwal", "Ritu Saxena", "Sameer Kale", "Tanvi More", "Yusuf Ansari",
]  # fmt: skip
# Orders by IST hour on a weekday: a late-morning peak and a bigger evening one. Store hours 8:00-22:00.
HOURLY = {8: 2, 9: 3, 10: 4, 11: 5, 12: 5, 13: 4, 14: 3, 15: 2, 16: 3, 17: 4, 18: 6, 19: 7, 20: 6, 21: 3}
SEARCHES = ["milk", "atta", "toor dal", "shampoo", "paneer", "biscuits", "rice", "ghee", "sugar", "tea"]
SPOKEN = ["haldi kahan milega", "चीनी कहाँ है", "where is the ghee", "doodh kahan hai", "मुझे आटा चाहिए"]
MISSING = ["jeera", "rajma", "olive oil", "oats", "peanut butter", "green tea"]
HELP = [
    ("find_item", "Where is jeera?"),
    ("stock", "Shelf is empty"),
    ("price", "Price differs"),
    ("other", None),
]
TEA = "Red Label Tea 250 g"


def _utc(local: datetime) -> datetime:
    return local.astimezone(UTC).replace(tzinfo=None)


async def clear(db: AsyncSession) -> bool:
    """Removes an earlier run. True if there was one."""
    users = list(await db.scalars(select(User.id).where(User.firebase_uid.startswith(PREFIX))))
    if not users:
        return False
    sessions = select(CartSession.id).where(CartSession.user_id.in_(users)).scalar_subquery()
    await db.execute(delete(SecurityAlert).where(SecurityAlert.session_id.in_(sessions)))
    await db.execute(delete(HelpRequest).where(HelpRequest.user_id.in_(users)))
    await db.execute(delete(Order).where(Order.user_id.in_(users)))
    await db.execute(delete(CartEvent).where(CartEvent.session_id.in_(sessions)))
    await db.execute(delete(CartSession).where(CartSession.user_id.in_(users)))
    await db.execute(delete(Offer).where(Offer.created_by.in_(users)))
    await db.execute(delete(User).where(User.id.in_(users)))
    return True


async def seed_history(db: AsyncSession, days: int, rng: random.Random) -> int:
    seeded_before = await clear(db)
    now = utcnow()
    today = now.replace(tzinfo=UTC).astimezone(IST).date()

    rows = (
        await db.execute(
            select(Product.id, Product.name, Product.gst_rate_bp, Inventory.aisle, StorePrice.price_paise)
            .join(Inventory, (Inventory.product_id == Product.id) & (Inventory.store_id == STORE_ID))
            .join(StorePrice, (StorePrice.product_id == Product.id) & (StorePrice.store_id == STORE_ID))
            .order_by(Product.name)
        )
    ).all()
    products = list({r.id: r for r in rows}.values())
    tea = next(p for p in products if p.name == TEA)

    users = [User(firebase_uid=f"{PREFIX}{i}", name=name) for i, name in enumerate(SHOPPERS)]
    db.add_all(users)
    await db.flush()

    # A deal that ran last week, so deal uplift has a finished offer to compare.
    tea_start = _utc(datetime.combine(today - timedelta(days=9), time(8), IST))
    tea_end = tea_start + timedelta(days=5)
    tea_price = round(tea.price_paise * 0.85 / 100) * 100
    db.add(
        Offer(
            store_id=STORE_ID,
            product_id=tea.id,
            title="Tea week",
            offer_price_paise=tea_price,
            starts_at=tea_start,
            ends_at=tea_end,
            created_by=users[0].id,
            created_at=tea_start - timedelta(days=1),
        )
    )

    await db.flush()
    # Every offer (last week's tea, and the seed's running deals) sells at its price, and a bit more.
    offers = [
        (o.product_id, o.offer_price_paise, o.starts_at, min(o.ends_at, o.ended_at or o.ends_at))
        for o in await db.scalars(select(Offer).where(Offer.store_id == STORE_ID))
    ]

    orders = 0
    for back in range(days, -1, -1):  # today too, up to now
        day = today - timedelta(days=back)
        weekend = day.weekday() >= 5
        for hour, base in HOURLY.items():
            for _ in range(round(base * (1.4 if weekend else 1) * rng.uniform(0.7, 1.3))):
                paid = _utc(datetime.combine(day, time(hour, rng.randrange(60)), IST))
                if paid >= now:
                    continue
                deals = {pid: price for pid, price, start, end in offers if start <= paid < end}
                await _order(db, rng, rng.choice(users), paid, products, deals)
                orders += 1
        if not seeded_before:
            _searches(db, rng, day)
        _help(db, rng, rng.choice(users), day, products)
    await _alerts(db, rng, days)
    await db.commit()
    return orders


async def _order(
    db: AsyncSession,
    rng: random.Random,
    user: User,
    paid: datetime,
    products: list[Any],
    deals: dict[str, int],
) -> None:
    minutes = rng.uniform(7, 38)
    started = paid - timedelta(minutes=minutes)
    session = CartSession(
        cart_id=f"C-{rng.randint(1, CART_COUNT):04d}",
        user_id=user.id,
        status=CartSessionStatus.paid,
        started_at=started,
        ended_at=paid,
    )
    db.add(session)
    await db.flush()
    picked = rng.sample(products, rng.randint(3, 12))
    for pid in deals:
        if rng.random() < 0.08 and all(p.id != pid for p in picked):
            picked.append(next(p for p in products if p.id == pid))
    total = tax = 0
    items = []
    for i, p in enumerate(picked):
        qty = 1 if rng.random() < 0.75 else 2
        unit = min(deals.get(p.id, p.price_paise), p.price_paise)
        line = qty * unit
        total += line
        tax += gst_included_paise(line, p.gst_rate_bp)
        items.append((p.id, qty, unit, p.gst_rate_bp))
        at = started + timedelta(minutes=minutes * (i + 1) / (len(picked) + 2))
        db.add(
            CartEvent(
                session_id=session.id,
                type="item.added",
                product_id=p.id,
                qty=qty,
                source=EventSource.phone,
                at=at,
            )
        )
    db.add(CartEvent(session_id=session.id, type="checkout.paid", source=EventSource.system, at=paid))
    order = Order(
        session_id=session.id,
        user_id=user.id,
        store_id=STORE_ID,
        subtotal_paise=total - tax,
        tax_paise=tax,
        total_paise=total,
        status=OrderStatus.paid,
        exit_code=None,  # long gone through the door; codes stay unique for live orders
        exit_used_at=paid + timedelta(minutes=rng.uniform(1, 4)),
        created_at=paid - timedelta(minutes=1),
    )
    db.add(order)
    await db.flush()
    db.add_all(
        OrderItem(order_id=order.id, product_id=pid, qty=qty, unit_price_paise=unit, gst_rate_bp=rate)
        for pid, qty, unit, rate in items
    )


def _searches(db: AsyncSession, rng: random.Random, day: date) -> None:
    for _ in range(rng.randint(18, 34)):
        r = rng.random()
        query, source, results = (
            (rng.choice(SPOKEN), "voice", 3)
            if r < 0.14
            else (rng.choice(MISSING), "search", 0)
            if r < 0.22
            else (rng.choice(SEARCHES), "list" if r < 0.4 else "search", 4)
        )
        at = _utc(datetime.combine(day, time(rng.choice(list(HOURLY)), rng.randrange(60)), IST))
        db.add(SearchLog(store_id=STORE_ID, query=query, source=source, result_count=results, at=at))


def _help(db: AsyncSession, rng: random.Random, user: User, day: date, products: list[Any]) -> None:
    for _ in range(rng.randint(1, 4)):
        topic, note = rng.choice(HELP)
        at = _utc(datetime.combine(day, time(rng.choice(list(HOURLY)), rng.randrange(60)), IST))
        db.add(
            HelpRequest(
                store_id=STORE_ID,
                user_id=user.id,
                aisle=rng.choice(products).aisle,
                topic=topic,
                note=note,
                status=HelpStatus.resolved,
                created_at=at,
                acknowledged_at=at + timedelta(minutes=rng.uniform(0.5, 4)),
                resolved_at=at + timedelta(minutes=rng.uniform(4, 9)),
            )
        )


async def _alerts(db: AsyncSession, rng: random.Random, days: int) -> None:
    """About one alert a day; most cleared by the shopper scanning, a few checked or false alarms."""
    sessions = list(
        await db.execute(
            select(CartSession.id, CartSession.cart_id, CartSession.started_at)
            .join(User, User.id == CartSession.user_id)
            .where(User.firebase_uid.startswith(PREFIX))
            .order_by(func.random())
            .limit(days + days // 2)
        )
    )
    for i, s in enumerate(sessions):
        kind = "exit_unpaid" if i % 6 == 5 else "unscanned_item"
        status = ["cleared", "cleared", "resolved", "cleared", "false_alarm", "resolved"][i % 6]
        at = s.started_at + timedelta(minutes=rng.uniform(3, 6))
        diff = rng.choice([250, 300, 450, 500, 900])
        db.add(
            SecurityAlert(
                store_id=STORE_ID,
                cart_id=s.cart_id,
                session_id=s.id,
                kind=kind,
                aisle="EXIT" if kind == "exit_unpaid" else rng.choice(["A1", "B2", "B3", "C1", "C2", "D1"]),
                details={"gateId": "G1", "sessionStatus": "active"}
                if kind == "exit_unpaid"
                else {"expectedG": 3000, "measuredG": 3000 + diff, "diffG": diff},
                status=status,
                created_at=at,
                closed_at=at + timedelta(minutes=rng.uniform(1, 6)),
            )
        )


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--days", type=int, default=14, help="days of history before today (default 14)")
    parser.add_argument("--seed", type=int, default=7, help="random seed (default 7)")
    args = parser.parse_args()
    if get_settings().env == "production":
        raise SystemExit("seed_history adds sample data; it refuses to run with ENV=production.")
    engine = make_engine(get_settings().async_database_url)
    try:
        async with make_sessionmaker(engine)() as db:
            n = await seed_history(db, max(1, min(args.days, 60)), random.Random(args.seed))
        print(f"Added {args.days} days of sample history to {STORE_ID}: {n} paid orders.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
