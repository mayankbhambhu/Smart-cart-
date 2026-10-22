"""Seeds one demo store, its carts, and the product catalogue from data/products.csv.

Safe to run more than once: everything is upserted by its natural key.
Run with `python -m smartcart.seed` (after `alembic upgrade head`).
"""

import asyncio
import csv
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import make_engine, make_sessionmaker
from .models import (
    Barcode,
    Cart,
    Category,
    FoodType,
    Inventory,
    Product,
    Section,
    Staff,
    StaffRole,
    Store,
    StorePrice,
    User,
)
from .taxonomy import SECTIONS, category_id

STORE_ID = "S-01"
CART_COUNT = 20
CSV_PATH = Path(__file__).parent / "data" / "products.csv"


def is_valid_ean13(code: str) -> bool:
    if len(code) != 13 or not code.isdigit():
        return False
    digits = [int(c) for c in code]
    total = sum(d * (3 if i % 2 else 1) for i, d in enumerate(digits[:12]))
    return (10 - total % 10) % 10 == digits[12]


def _opt(value: str) -> str | None:
    return value or None


async def seed(db: AsyncSession) -> int:
    await db.execute(
        insert(Store)
        .values(id=STORE_ID, name="DMart Pilot Store (demo)", city="Mumbai")
        .on_conflict_do_nothing(index_elements=["id"])
    )
    for n in range(1, CART_COUNT + 1):
        cart_id = f"C-{n:04d}"
        await db.execute(
            insert(Cart)
            .values(
                id=cart_id, store_id=STORE_ID, qr_code=f"smartcart://pair?cart={cart_id}&store={STORE_ID}"
            )
            .on_conflict_do_nothing(index_elements=["id"])
        )

    categories: dict[str, str] = {}
    for order, (section_id, name, icon, names) in enumerate(SECTIONS):
        values = {"name": name, "icon": icon, "sort_order": order}
        await db.execute(
            insert(Section)
            .values(id=section_id, **values)
            .on_conflict_do_update(index_elements=["id"], set_=values)
        )
        for n, cat in enumerate(names):
            cid = category_id(section_id, cat)
            values = {"section_id": section_id, "name": cat, "sort_order": n}
            await db.execute(
                insert(Category)
                .values(id=cid, **values)
                .on_conflict_do_update(index_elements=["id"], set_=values)
            )
            categories[cat] = cid

    with CSV_PATH.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        code = r["barcode"]
        if not is_valid_ean13(code):
            raise ValueError(f"Invalid EAN-13 in seed: {code}")
        fields = {
            "name": r["name"],
            "brand": _opt(r["brand"]),
            "category": r["category"],
            "category_id": categories[r["category"]],
            "food_type": FoodType(r["food_type"]) if r.get("food_type") else None,
            "hsn_code": r["hsn_code"],
            "gst_rate_bp": int(r["gst_rate_bp"]),
            "weight_g": int(r["weight_g"]) if r["weight_g"] else None,
            "diet_tags": [t for t in r.get("diet", "").split(";") if t],
        }
        barcode = await db.get(Barcode, code)
        if barcode:
            product = await db.get_one(Product, barcode.product_id)
            for key, value in fields.items():
                setattr(product, key, value)
        else:
            product = Product(**fields)
            db.add(product)
            await db.flush()
            db.add(Barcode(code=code, product_id=product.id))

        mrp, price = int(r["mrp_paise"]), int(r["price_paise"])
        current = await db.scalar(
            select(StorePrice)
            .where(StorePrice.store_id == STORE_ID, StorePrice.product_id == product.id)
            .order_by(StorePrice.valid_from.desc())
            .limit(1)
        )
        if not current or current.mrp_paise != mrp or current.price_paise != price:
            db.add(StorePrice(store_id=STORE_ID, product_id=product.id, mrp_paise=mrp, price_paise=price))

        location = {"aisle": _opt(r["aisle"]), "shelf": _opt(r["shelf"])}
        inventory = await db.get(Inventory, (STORE_ID, product.id))
        if inventory:
            inventory.aisle, inventory.shelf = location["aisle"], location["shelf"]
        else:
            db.add(
                Inventory(
                    store_id=STORE_ID,
                    product_id=product.id,
                    on_hand=int(r["on_hand"]),
                    low_stock_threshold=int(r["low_stock_threshold"]),
                    **location,
                )
            )
        await db.flush()

    # Demo accounts for AUTH_MODE=dev: the dashboard signs in as "dev:staff-demo" (store manager) and
    # "dev:admin-demo" is the SmartCart admin team, who approve staff accounts. Real store-team
    # accounts are made only through a manager's request and the admin team's approval.
    for uid, name, role, code in (
        ("staff-demo", "Demo Store Manager", StaffRole.manager, "S01-0001"),
        ("admin-demo", "SmartCart Admin (demo)", StaffRole.admin, "ADM-0001"),
    ):
        user = await db.scalar(select(User).where(User.firebase_uid == uid))
        if not user:
            user = User(firebase_uid=uid, name=name)
            db.add(user)
            await db.flush()
        existing = await db.scalar(select(Staff).where(Staff.user_id == user.id, Staff.store_id == STORE_ID))
        if not existing:
            db.add(Staff(user_id=user.id, store_id=STORE_ID, role=role, staff_code=code, full_name=name))
        elif not existing.staff_code:
            existing.staff_code, existing.full_name = code, name

    await db.commit()
    return len(rows)


async def main() -> None:
    engine = make_engine(get_settings().async_database_url)
    try:
        async with make_sessionmaker(engine)() as db:
            count = await seed(db)
        print(f"Seeded store {STORE_ID}, {CART_COUNT} carts, {count} products.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
