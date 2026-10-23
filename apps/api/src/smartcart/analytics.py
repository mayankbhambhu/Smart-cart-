"""Store analytics (milestone 7): the numbers a store manager reviews during the pilot, computed in Python.

Everything is counted from what the store recorded: paid orders, the cart event log, searches, help
requests and security alerts. `compute` is plain Python over those rows, so it is tested without a
database; `load` fetches them. Where the data can't support an answer (a deal with no sales before
it started to compare with), the answer is None, never an estimate.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone
from statistics import median
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    Cart,
    CartEvent,
    CartSession,
    Category,
    HelpRequest,
    Inventory,
    Offer,
    Order,
    OrderItem,
    OrderStatus,
    Product,
    SearchLog,
    Section,
    SecurityAlert,
    StorePrice,
    utcnow,
)

IST = timezone(timedelta(hours=5, minutes=30), "IST")
MAX_DAYS = 90
# Offers last at most 31 days, so a baseline never reaches further back than this before the window.
BASELINE_DAYS = 31
TOP_PRODUCTS = 10
TOP_AISLES = 12
# Below these, an uplift figure would be noise: report None ("not enough data yet") instead.
MIN_UPLIFT_DAYS = 1
MIN_BASELINE_UNITS = 5


@dataclass(frozen=True)
class Sale:
    """One line of a paid order."""

    product_id: str
    name: str
    section: str
    qty: int
    unit_paise: int
    # The product's regular shelf price, to tell a deal sale from a full-price one.
    regular_paise: int | None


@dataclass(frozen=True)
class PaidOrder:
    id: str
    started_at: datetime  # when the shopper paired the cart
    paid_at: datetime
    total_paise: int
    lines: tuple[Sale, ...]

    @property
    def items(self) -> int:
        return sum(s.qty for s in self.lines)


@dataclass(frozen=True)
class OfferWindow:
    id: str
    product_id: str
    name: str
    title: str
    offer_price_paise: int
    starts_at: datetime
    ends_at: datetime  # when it actually stopped: its end, or when a manager ended it early


@dataclass
class Activity:
    """Everything else shoppers and the floor did in the window."""

    scans: list[str] = field(default_factory=list)  # the aisle of each item scanned into a cart
    help_aisles: list[str | None] = field(default_factory=list)
    searches: list[tuple[str, int]] = field(default_factory=list)  # (source, result count)
    alerts: list[tuple[str, str]] = field(default_factory=list)  # (kind, status)


def _iso(dt: datetime) -> str:
    return dt.replace(tzinfo=None).isoformat() + "Z"


def _ist(dt: datetime) -> datetime:
    return dt.replace(tzinfo=UTC).astimezone(IST)


def _rate(n: float, d: float) -> float | None:
    return round(n / d, 3) if d else None


def compute(
    store_id: str,
    days: int,
    until: datetime,
    orders: list[PaidOrder],
    offers: list[OfferWindow],
    activity: Activity,
) -> dict[str, Any]:
    """The Analytics page. `orders` may start before the window: earlier ones are the deal baselines."""
    since = until - timedelta(days=days)
    window = [o for o in orders if since <= o.paid_at < until]
    revenue = sum(o.total_paise for o in window)
    minutes_to_pay = [(o.paid_at - o.started_at).total_seconds() / 60 for o in window]

    by_hour = [{"hour": h, "orders": 0, "revenuePaise": 0} for h in range(24)]
    first_day = _ist(since).date()
    by_day: dict[date, dict[str, Any]] = {}
    for i in range((_ist(until).date() - first_day).days + 1):
        d = first_day + timedelta(days=i)
        by_day[d] = {"date": d.isoformat(), "orders": 0, "revenuePaise": 0}
    for o in window:
        local = _ist(o.paid_at)
        for row in (by_hour[local.hour], by_day[local.date()]):
            row["orders"] += 1
            row["revenuePaise"] += o.total_paise

    units: Counter[str] = Counter()
    product_revenue: Counter[str] = Counter()
    names: dict[str, str] = {}
    section_revenue: Counter[str] = Counter()
    for o in window:
        for s in o.lines:
            units[s.product_id] += s.qty
            product_revenue[s.product_id] += s.qty * s.unit_paise
            names[s.product_id] = s.name
            section_revenue[s.section] += s.qty * s.unit_paise
    sold = sum(section_revenue.values())

    return {
        "storeId": store_id,
        "days": days,
        "from": _iso(since),
        "to": _iso(until),
        "timezone": "Asia/Kolkata",
        "summary": {
            "orders": len(window),
            "revenuePaise": revenue,
            "avgBasketPaise": round(revenue / len(window)) if window else None,
            "avgItems": round(sum(o.items for o in window) / len(window), 1) if window else None,
            "medianMinutesToPay": round(median(minutes_to_pay), 1) if minutes_to_pay else None,
        },
        "byHour": by_hour,
        "byDay": list(by_day.values()),
        "topProducts": [
            {"productId": p, "name": names[p], "qty": n, "revenuePaise": product_revenue[p]}
            for p, n in sorted(units.items(), key=lambda kv: (-kv[1], -product_revenue[kv[0]], names[kv[0]]))[
                :TOP_PRODUCTS
            ]
        ],
        "categoryMix": [
            {"section": s, "revenuePaise": r, "share": round(r / sold, 3)}
            for s, r in sorted(section_revenue.items(), key=lambda kv: -kv[1])
        ],
        "deals": _deals(window, orders, offers, since, until),
        "busyAisles": _aisles(activity),
        "searches": {
            "total": len(activity.searches),
            "voice": sum(src == "voice" for src, _ in activity.searches),
            "voiceShare": _rate(sum(src == "voice" for src, _ in activity.searches), len(activity.searches)),
            "missed": sum(n == 0 for _, n in activity.searches),
        },
        "security": _security(activity.alerts),
    }


def _deals(
    window: list[PaidOrder],
    orders: list[PaidOrder],
    offers: list[OfferWindow],
    since: datetime,
    until: datetime,
) -> dict[str, Any]:
    """Deal sales in the window, and for each offer how its product sold compared with before it."""

    def on_offer(product_id: str, at: datetime) -> bool:
        return any(w.product_id == product_id and w.starts_at <= at < w.ends_at for w in offers)

    deal_orders = 0
    deal_units = 0
    savings = 0
    for o in window:
        hits = [
            s
            for s in o.lines
            if s.regular_paise and s.unit_paise < s.regular_paise and on_offer(s.product_id, o.paid_at)
        ]
        deal_orders += bool(hits)
        deal_units += sum(s.qty for s in hits)
        savings += sum((s.regular_paise or 0) - s.unit_paise for s in hits for _ in range(s.qty))

    uplift = []
    for w in sorted(offers, key=lambda w: w.starts_at):
        end = min(w.ends_at, until)
        if end <= since or w.starts_at >= until:
            continue
        # At least a day either side, so an offer an hour old isn't read as a daily rate.
        length = max(end - w.starts_at, timedelta(days=1))
        before_start = w.starts_at - length

        def sold(lo: datetime, hi: datetime, product_id: str = w.product_id) -> int:
            return sum(
                s.qty for o in orders if lo <= o.paid_at < hi for s in o.lines if s.product_id == product_id
            )

        during = sold(w.starts_at, end)
        before = sold(before_start, w.starts_at)
        # Only compare when the store was trading before the offer and the product sold then.
        had_history = any(before_start <= o.paid_at < w.starts_at for o in orders)
        per_day = length.total_seconds() / 86_400
        comparable = (
            had_history
            and before >= MIN_BASELINE_UNITS
            and (end - w.starts_at) >= timedelta(days=MIN_UPLIFT_DAYS)
        )
        uplift.append(
            {
                "offerId": w.id,
                "productId": w.product_id,
                "name": w.name,
                "title": w.title,
                "startsAt": _iso(w.starts_at),
                "endsAt": _iso(w.ends_at),
                "running": w.ends_at > until,
                "unitsDuring": during,
                "unitsBefore": before if had_history else None,
                "unitsPerDayDuring": round(during / per_day, 1),
                "unitsPerDayBefore": round(before / per_day, 1) if had_history else None,
                "upliftPct": round((during - before) / before * 100) if comparable else None,
            }
        )
    return {
        "ordersWithDeal": deal_orders,
        "dealShare": _rate(deal_orders, len(window)),
        "dealUnits": deal_units,
        "savingsPaise": savings,
        "offers": uplift,
    }


def _aisles(activity: Activity) -> list[dict[str, Any]]:
    scans = Counter(activity.scans)
    help_ = Counter(a for a in activity.help_aisles if a)
    aisles = sorted(set(scans) | set(help_), key=lambda a: (-scans[a], -help_[a], a))
    return [{"aisle": a, "scans": scans[a], "helpRequests": help_[a]} for a in aisles[:TOP_AISLES]]


def _security(alerts: list[tuple[str, str]]) -> dict[str, int]:
    status = Counter(s for _, s in alerts)
    kind = Counter(k for k, _ in alerts)
    return {
        "total": len(alerts),
        "unscannedItem": kind["unscanned_item"],
        "exitUnpaid": kind["exit_unpaid"],
        "clearedByShopper": status["cleared"],
        "checkedByStaff": status["resolved"],
        "falseAlarms": status["false_alarm"],
        "open": status["open"] + status["acknowledged"],
    }


# ---- Loading the rows --------------------------------------------------------------------------------


async def load(db: AsyncSession, store_id: str, days: int) -> dict[str, Any]:
    days = max(1, min(days, MAX_DAYS))
    until = utcnow()
    since = until - timedelta(days=days)
    earliest = since - timedelta(days=BASELINE_DAYS)

    paid_at = (
        select(CartEvent.session_id, func.max(CartEvent.at).label("at"))
        .where(CartEvent.type == "checkout.paid")
        .group_by(CartEvent.session_id)
        .subquery()
    )
    paid_time = func.coalesce(paid_at.c.at, Order.created_at)
    order_rows = (
        await db.execute(
            select(Order.id, Order.total_paise, CartSession.started_at, paid_time.label("paid_at"))
            .join(CartSession, CartSession.id == Order.session_id)
            .outerjoin(paid_at, paid_at.c.session_id == Order.session_id)
            .where(Order.store_id == store_id, Order.status == OrderStatus.paid, paid_time >= earliest)
        )
    ).all()

    regular = {
        r.product_id: r.price_paise
        for r in await db.execute(
            select(StorePrice.product_id, StorePrice.price_paise)
            .where(StorePrice.store_id == store_id, StorePrice.valid_from <= until)
            .order_by(StorePrice.product_id, StorePrice.valid_from.desc())
            .ext(distinct_on(StorePrice.product_id))
        )
    }
    lines: dict[str, list[Sale]] = defaultdict(list)
    if order_rows:
        for r in await db.execute(
            select(
                OrderItem.order_id,
                OrderItem.product_id,
                OrderItem.qty,
                OrderItem.unit_price_paise,
                Product.name,
                func.coalesce(Section.name, Product.category).label("section"),
            )
            .join(Product, Product.id == OrderItem.product_id)
            .outerjoin(Category, Category.id == Product.category_id)
            .outerjoin(Section, Section.id == Category.section_id)
            .where(OrderItem.order_id.in_([o.id for o in order_rows]))
        ):
            lines[r.order_id].append(
                Sale(r.product_id, r.name, r.section, r.qty, r.unit_price_paise, regular.get(r.product_id))
            )
    orders = [PaidOrder(o.id, o.started_at, o.paid_at, o.total_paise, tuple(lines[o.id])) for o in order_rows]

    offers = [
        OfferWindow(
            o.id,
            o.product_id,
            name,
            o.title,
            o.offer_price_paise,
            o.starts_at,
            min(o.ends_at, o.ended_at) if o.ended_at else o.ends_at,
        )
        for o, name in await db.execute(
            select(Offer, Product.name)
            .join(Product, Product.id == Offer.product_id)
            .where(Offer.store_id == store_id, Offer.starts_at < until, Offer.ends_at > earliest)
        )
    ]

    scans = await db.scalars(
        select(Inventory.aisle)
        .select_from(CartEvent)
        .join(CartSession, CartSession.id == CartEvent.session_id)
        .join(Cart, Cart.id == CartSession.cart_id)
        .join(
            Inventory, (Inventory.product_id == CartEvent.product_id) & (Inventory.store_id == Cart.store_id)
        )
        .where(
            Cart.store_id == store_id,
            CartEvent.type == "item.added",
            CartEvent.at >= since,
            Inventory.aisle.is_not(None),
        )
    )
    activity = Activity(
        scans=[a for a in scans if a],
        help_aisles=list(
            await db.scalars(
                select(HelpRequest.aisle).where(
                    HelpRequest.store_id == store_id, HelpRequest.created_at >= since
                )
            )
        ),
        searches=[
            (r.source, r.result_count)
            for r in await db.execute(
                select(SearchLog.source, SearchLog.result_count).where(
                    SearchLog.store_id == store_id, SearchLog.at >= since
                )
            )
        ],
        alerts=[
            (r.kind, r.status)
            for r in await db.execute(
                select(SecurityAlert.kind, SecurityAlert.status).where(
                    SecurityAlert.store_id == store_id, SecurityAlert.created_at >= since
                )
            )
        ],
    )
    return compute(store_id, days, until, orders, offers, activity)
