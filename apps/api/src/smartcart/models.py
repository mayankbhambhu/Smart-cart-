"""SQLAlchemy models for the V1 data model (see docs/architecture.md, "Data model").

Money is integer paise; rates are basis points. Every store-scoped table carries store_id so a
second store is data, not a migration. Timestamps are naive UTC, as stored by the original schema.
"""

import enum
import uuid
from datetime import UTC, datetime
from typing import Any, ClassVar

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Base(DeclarativeBase):
    metadata = MetaData()
    type_annotation_map: ClassVar[dict[Any, Any]] = {str: Text()}


def pg_enum(cls: type[enum.Enum], name: str) -> Enum:
    return Enum(cls, name=name, values_callable=lambda e: [m.value for m in e])


class StaffRole(enum.StrEnum):
    manager = "manager"
    clerk = "clerk"
    admin = "admin"


class StockReason(enum.StrEnum):
    sale = "sale"
    restock = "restock"
    adjust = "adjust"


class CartStatus(enum.StrEnum):
    available = "available"
    in_use = "in_use"
    maintenance = "maintenance"


class CartSessionStatus(enum.StrEnum):
    active = "active"
    checking_out = "checking_out"
    paid = "paid"
    abandoned = "abandoned"


class EventSource(enum.StrEnum):
    phone = "phone"
    cart = "cart"
    system = "system"
    staff = "staff"


class OrderStatus(enum.StrEnum):
    pending_payment = "pending_payment"
    paid = "paid"
    cancelled = "cancelled"
    refunded = "refunded"


class PaymentStatus(enum.StrEnum):
    created = "created"
    succeeded = "succeeded"
    failed = "failed"
    refunded = "refunded"


OPEN_SESSION = text("status IN ('active', 'checking_out')")


class Store(Base):
    __tablename__ = "stores"
    id: Mapped[str] = mapped_column(primary_key=True)  # e.g. S-01
    name: Mapped[str]
    city: Mapped[str]
    timezone: Mapped[str] = mapped_column(server_default="Asia/Kolkata")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=text("CURRENT_TIMESTAMP")
    )


class User(Base):
    __tablename__ = "users"
    __table_args__ = (Index("users_firebase_uid_key", "firebase_uid", unique=True),)
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    firebase_uid: Mapped[str]
    name: Mapped[str | None]
    phone: Mapped[str | None]
    email: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=text("CURRENT_TIMESTAMP")
    )


class Staff(Base):
    __tablename__ = "staff"
    __table_args__ = (Index("staff_user_id_store_id_key", "user_id", "store_id", unique=True),)
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", onupdate="CASCADE", ondelete="RESTRICT"))
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", onupdate="CASCADE", ondelete="RESTRICT"))
    role: Mapped[StaffRole] = mapped_column(pg_enum(StaffRole, "StaffRole"))


class Product(Base):
    __tablename__ = "products"
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    name: Mapped[str]
    brand: Mapped[str | None]
    category: Mapped[str]
    image_url: Mapped[str | None]
    hsn_code: Mapped[str]
    gst_rate_bp: Mapped[int] = mapped_column(Integer)
    # Net pack weight in grams; used by the V3 weight-to-scan check.
    weight_g: Mapped[int | None] = mapped_column(Integer)

    barcodes: Mapped[list["Barcode"]] = relationship(back_populates="product")


class Barcode(Base):
    __tablename__ = "barcodes"
    __table_args__ = (Index("barcodes_product_id_idx", "product_id"),)
    code: Mapped[str] = mapped_column(primary_key=True)  # EAN-13
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id", onupdate="CASCADE", ondelete="CASCADE"))
    product: Mapped[Product] = relationship(back_populates="barcodes")


class StorePrice(Base):
    __tablename__ = "store_prices"
    __table_args__ = (
        Index(
            "store_prices_store_id_product_id_valid_from_idx",
            "store_id",
            "product_id",
            text("valid_from DESC"),
        ),
    )
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", onupdate="CASCADE", ondelete="RESTRICT"))
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id", onupdate="CASCADE", ondelete="CASCADE"))
    mrp_paise: Mapped[int] = mapped_column(Integer)
    price_paise: Mapped[int] = mapped_column(Integer)
    valid_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=text("CURRENT_TIMESTAMP")
    )


class Inventory(Base):
    __tablename__ = "inventory"
    store_id: Mapped[str] = mapped_column(
        ForeignKey("stores.id", onupdate="CASCADE", ondelete="RESTRICT"), primary_key=True
    )
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.id", onupdate="CASCADE", ondelete="CASCADE"), primary_key=True
    )
    on_hand: Mapped[int] = mapped_column(Integer)
    reserved: Mapped[int] = mapped_column(Integer, server_default="0", default=0)
    low_stock_threshold: Mapped[int] = mapped_column(Integer, server_default="10", default=10)
    # Aisle and shelf are captured now for V3 aisle routing.
    aisle: Mapped[str | None]
    shelf: Mapped[str | None]
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), default=utcnow, onupdate=utcnow)

    product: Mapped[Product] = relationship()


class StockMovement(Base):
    __tablename__ = "stock_movements"
    __table_args__ = (Index("stock_movements_store_id_product_id_at_idx", "store_id", "product_id", "at"),)
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", onupdate="CASCADE", ondelete="RESTRICT"))
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.id", onupdate="CASCADE", ondelete="RESTRICT")
    )
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[StockReason] = mapped_column(pg_enum(StockReason, "StockReason"))
    ref_id: Mapped[str | None]
    at: Mapped[datetime] = mapped_column(DateTime(timezone=False), server_default=text("CURRENT_TIMESTAMP"))


class Cart(Base):
    __tablename__ = "carts"
    __table_args__ = (
        Index("carts_store_id_status_idx", "store_id", "status"),
        Index("carts_qr_code_key", "qr_code", unique=True),
        Index("carts_hardware_id_key", "hardware_id", unique=True),
    )
    id: Mapped[str] = mapped_column(primary_key=True)  # printed cart code, e.g. C-0042
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", onupdate="CASCADE", ondelete="RESTRICT"))
    qr_code: Mapped[str]
    status: Mapped[CartStatus] = mapped_column(
        pg_enum(CartStatus, "CartStatus"), server_default="available", default=CartStatus.available
    )
    # AWS IoT Core thing name, set in V2.
    hardware_id: Mapped[str | None]


class CartSession(Base):
    __tablename__ = "cart_sessions"
    __table_args__ = (
        Index("cart_sessions_cart_id_status_idx", "cart_id", "status"),
        # One open session per cart and per shopper; pairing relies on these to reject races.
        Index("cart_sessions_one_open_per_cart", "cart_id", unique=True, postgresql_where=OPEN_SESSION),
        Index("cart_sessions_one_open_per_user", "user_id", unique=True, postgresql_where=OPEN_SESSION),
    )
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    cart_id: Mapped[str] = mapped_column(ForeignKey("carts.id", onupdate="CASCADE", ondelete="RESTRICT"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", onupdate="CASCADE", ondelete="RESTRICT"))
    status: Mapped[CartSessionStatus] = mapped_column(
        pg_enum(CartSessionStatus, "CartSessionStatus"),
        server_default="active",
        default=CartSessionStatus.active,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=utcnow, server_default=text("CURRENT_TIMESTAMP")
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))

    cart: Mapped[Cart] = relationship(lazy="joined")
    user: Mapped[User] = relationship()


class CartEvent(Base):
    """Append-only log of cart changes. The live Redis cart is a projection of this table."""

    __tablename__ = "cart_events"
    __table_args__ = (
        Index("cart_events_session_id_at_idx", "session_id", "at"),
        Index("cart_events_request_id_key", "request_id", unique=True),
    )
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("cart_sessions.id", onupdate="CASCADE", ondelete="RESTRICT")
    )
    type: Mapped[str]
    product_id: Mapped[str | None] = mapped_column(
        ForeignKey("products.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    qty: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[EventSource] = mapped_column(pg_enum(EventSource, "EventSource"))
    request_id: Mapped[str | None]
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=utcnow, server_default=text("CURRENT_TIMESTAMP")
    )


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        Index("orders_store_id_created_at_idx", "store_id", "created_at"),
        Index("orders_session_id_key", "session_id", unique=True),
        Index("orders_exit_code_key", "exit_code", unique=True),
    )
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("cart_sessions.id", onupdate="CASCADE", ondelete="RESTRICT")
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", onupdate="CASCADE", ondelete="RESTRICT"))
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", onupdate="CASCADE", ondelete="RESTRICT"))
    subtotal_paise: Mapped[int] = mapped_column(Integer)
    tax_paise: Mapped[int] = mapped_column(Integer)
    total_paise: Mapped[int] = mapped_column(Integer)
    status: Mapped[OrderStatus] = mapped_column(
        pg_enum(OrderStatus, "OrderStatus"),
        server_default="pending_payment",
        default=OrderStatus.pending_payment,
    )
    exit_code: Mapped[str | None]
    exit_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=text("CURRENT_TIMESTAMP")
    )


class OrderItem(Base):
    __tablename__ = "order_items"
    order_id: Mapped[str] = mapped_column(
        ForeignKey("orders.id", onupdate="CASCADE", ondelete="CASCADE"), primary_key=True
    )
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.id", onupdate="CASCADE", ondelete="RESTRICT"), primary_key=True
    )
    qty: Mapped[int] = mapped_column(Integer)
    unit_price_paise: Mapped[int] = mapped_column(Integer)
    gst_rate_bp: Mapped[int] = mapped_column(Integer)


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        Index("payments_order_id_idx", "order_id"),
        Index("payments_provider_order_id_key", "provider_order_id", unique=True),
    )
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", onupdate="CASCADE", ondelete="RESTRICT"))
    provider: Mapped[str]  # "stripe" in V1; "razorpay" possible later
    provider_order_id: Mapped[str | None]
    provider_payment_id: Mapped[str | None]
    status: Mapped[PaymentStatus] = mapped_column(
        pg_enum(PaymentStatus, "PaymentStatus"), server_default="created", default=PaymentStatus.created
    )
    raw_webhook: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=text("CURRENT_TIMESTAMP")
    )
