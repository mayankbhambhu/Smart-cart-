from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession

from .models import StorePrice, utcnow


@dataclass(frozen=True)
class Price:
    mrp_paise: int
    price_paise: int


async def current_prices(db: AsyncSession, store_id: str, product_ids: list[str]) -> dict[str, Price]:
    """The price in force for each product at a store: the latest store_prices row by valid_from."""
    if not product_ids:
        return {}
    rows = await db.execute(
        select(StorePrice.product_id, StorePrice.mrp_paise, StorePrice.price_paise)
        .where(
            StorePrice.store_id == store_id,
            StorePrice.product_id.in_(product_ids),
            StorePrice.valid_from <= utcnow(),
        )
        .order_by(StorePrice.product_id, StorePrice.valid_from.desc())
        .ext(distinct_on(StorePrice.product_id))
    )
    return {r.product_id: Price(r.mrp_paise, r.price_paise) for r in rows}
