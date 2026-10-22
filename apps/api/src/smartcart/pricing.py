from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import ColumnElement, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Offer, StorePrice, utcnow


@dataclass(frozen=True)
class OfferTag:
    """The running offer behind a price, so screens can show "was ₹28" and when it ends."""

    id: str
    title: str
    regular_paise: int
    ends_at: datetime

    def wire(self) -> dict[str, object]:
        return {
            "id": self.id,
            "title": self.title,
            "regularPaise": self.regular_paise,
            "endsAt": self.ends_at.isoformat() + "Z",
        }


@dataclass(frozen=True)
class Price:
    mrp_paise: int
    price_paise: int
    offer: OfferTag | None = None


def active_offer_filter(store_id: str, now: datetime) -> list[ColumnElement[bool]]:
    """Offers running at this store now: started, not past their end, not ended early."""
    return [
        Offer.store_id == store_id,
        Offer.starts_at <= now,
        Offer.ends_at > now,
        Offer.ended_at.is_(None),
    ]


async def current_prices(db: AsyncSession, store_id: str, product_ids: list[str]) -> dict[str, Price]:
    """The price in force for each product at a store: the latest store_prices row by valid_from,
    or a running offer's price when it is lower. Search, carts and checkout all price through here."""
    if not product_ids:
        return {}
    now = utcnow()
    rows = await db.execute(
        select(StorePrice.product_id, StorePrice.mrp_paise, StorePrice.price_paise)
        .where(
            StorePrice.store_id == store_id,
            StorePrice.product_id.in_(product_ids),
            StorePrice.valid_from <= now,
        )
        .order_by(StorePrice.product_id, StorePrice.valid_from.desc())
        .ext(distinct_on(StorePrice.product_id))
    )
    prices = {r.product_id: Price(r.mrp_paise, r.price_paise) for r in rows}
    offers = await db.scalars(
        select(Offer)
        .where(Offer.product_id.in_(list(prices)), *active_offer_filter(store_id, now))
        .order_by(Offer.offer_price_paise)
    )
    for o in offers:
        base = prices[o.product_id]
        if base.offer is None and o.offer_price_paise < base.price_paise:
            tag = OfferTag(o.id, o.title, base.price_paise, o.ends_at)
            prices[o.product_id] = Price(base.mrp_paise, o.offer_price_paise, tag)
    return prices
