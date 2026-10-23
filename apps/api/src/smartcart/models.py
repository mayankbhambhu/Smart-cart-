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
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
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
    floor_staff = "floor_staff"
    manager = "manager"
    # The SmartCart team (not store staff): approves staff accounts for every store.
    admin = "admin"


class StaffStatus(enum.StrEnum):
    active = "active"
    # A deactivation request is waiting for the admin team; the person cannot sign in meanwhile.
    suspended = "suspended"
    deactivated = "deactivated"


class StaffRequestType(enum.StrEnum):
    create = "create"
    deactivate = "deactivate"


class StaffRequestStatus(enum.StrEnum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    changes_requested = "changes_requested"


class ReservationStatus(enum.StrEnum):
    reserved = "reserved"
    picked = "picked"
    collected = "collected"
    expired = "expired"
    cancelled = "cancelled"


class TaskType(enum.StrEnum):
    restock = "restock"
    pick = "pick"
    stock_check = "stock_check"
    other = "other"


class TaskStatus(enum.StrEnum):
    open = "open"
    done = "done"
    cancelled = "cancelled"


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


class HelpStatus(enum.StrEnum):
    open = "open"
    acknowledged = "acknowledged"
    resolved = "resolved"
    cancelled = "cancelled"


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
    """A store-team account. Created only by approving a staff request, never by self sign-up."""

    __tablename__ = "staff"
    __table_args__ = (
        Index("staff_user_id_store_id_key", "user_id", "store_id", unique=True),
        Index("staff_staff_code_key", "staff_code", unique=True),
        Index("staff_phone_key", "phone", unique=True),
    )
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", onupdate="CASCADE", ondelete="RESTRICT"))
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", onupdate="CASCADE", ondelete="RESTRICT"))
    role: Mapped[StaffRole] = mapped_column(pg_enum(StaffRole, "StaffRole"))
    # Sign-in: staff ID (e.g. S01-0042) or the registered mobile (+91...) plus a password.
    staff_code: Mapped[str | None]
    full_name: Mapped[str | None]
    phone: Mapped[str | None]
    shift: Mapped[str | None]
    employee_ref: Mapped[str | None]
    password_hash: Mapped[str | None]
    must_change_password: Mapped[bool] = mapped_column(server_default="false", default=False)
    temp_password_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    failed_logins: Mapped[int] = mapped_column(Integer, server_default="0", default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    status: Mapped[StaffStatus] = mapped_column(
        pg_enum(StaffStatus, "StaffStatus"), server_default="active", default=StaffStatus.active
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=utcnow, server_default=text("CURRENT_TIMESTAMP")
    )

    user: Mapped[User] = relationship()


class FoodType(enum.StrEnum):
    veg = "veg"
    non_veg = "non_veg"
    egg = "egg"
    not_food = "not_food"


class Section(Base):
    """A browsing section in the app: Fruits, Dairy and eggs, Staples, ..."""

    __tablename__ = "sections"
    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str]
    icon: Mapped[str | None]
    sort_order: Mapped[int] = mapped_column(Integer, server_default="0")

    categories: Mapped[list["Category"]] = relationship(
        back_populates="section", order_by="Category.sort_order", lazy="selectin"
    )


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (Index("categories_section_id_idx", "section_id"),)
    id: Mapped[str] = mapped_column(primary_key=True)
    section_id: Mapped[str] = mapped_column(
        ForeignKey("sections.id", onupdate="CASCADE", ondelete="RESTRICT")
    )
    name: Mapped[str]
    sort_order: Mapped[int] = mapped_column(Integer, server_default="0")

    section: Mapped[Section] = relationship(back_populates="categories")


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (Index("products_category_id_idx", "category_id"),)
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    name: Mapped[str]
    brand: Mapped[str | None]
    # The category's name, kept on the product so search can match it ("tea", "eggs").
    category: Mapped[str]
    category_id: Mapped[str | None] = mapped_column(
        ForeignKey("categories.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    # From the pack's FSSAI dot. Null means nobody has labelled it yet: shown as "not labelled".
    food_type: Mapped[FoodType | None] = mapped_column(pg_enum(FoodType, "FoodType"))
    image_url: Mapped[str | None]
    hsn_code: Mapped[str]
    gst_rate_bp: Mapped[int] = mapped_column(Integer)
    # Net pack weight in grams; used by the V3 weight-to-scan check.
    weight_g: Mapped[int | None] = mapped_column(Integer)
    # Diet claims shoppers can filter by (taxonomy.DIET_TAGS). Only what the pack label states.
    diet_tags: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}", default=list)

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


class SearchLog(Base):
    """What shoppers looked for, so the operations lead can see what the store failed to answer (US-10)."""

    __tablename__ = "search_logs"
    __table_args__ = (Index("search_logs_store_at_idx", "store_id", "at"),)
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", onupdate="CASCADE", ondelete="RESTRICT"))
    query: Mapped[str]
    source: Mapped[str]  # search | voice | list | assistant
    result_count: Mapped[int] = mapped_column(Integer)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=False), server_default=text("CURRENT_TIMESTAMP"))


class HelpRequest(Base):
    """A shopper asking for floor staff from the app (US-07), shown on staff screens (US-09)."""

    __tablename__ = "help_requests"
    __table_args__ = (Index("help_requests_store_status_idx", "store_id", "status"),)
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", onupdate="CASCADE", ondelete="RESTRICT"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", onupdate="CASCADE", ondelete="RESTRICT"))
    cart_id: Mapped[str | None] = mapped_column(
        ForeignKey("carts.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    aisle: Mapped[str | None]
    topic: Mapped[str]  # find_item | price | stock | other
    note: Mapped[str | None]
    status: Mapped[HelpStatus] = mapped_column(
        pg_enum(HelpStatus, "HelpStatus"), server_default="open", default=HelpStatus.open
    )
    handled_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=text("CURRENT_TIMESTAMP")
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))

    user: Mapped[User] = relationship(foreign_keys=[user_id])


class StaffRequest(Base):
    """A manager asking the SmartCart admin team to add or deactivate a store-team account."""

    __tablename__ = "staff_requests"
    __table_args__ = (Index("staff_requests_status_idx", "status", "created_at"),)
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    type: Mapped[StaffRequestType] = mapped_column(pg_enum(StaffRequestType, "StaffRequestType"))
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", onupdate="CASCADE", ondelete="RESTRICT"))
    requested_by: Mapped[str] = mapped_column(ForeignKey("users.id", onupdate="CASCADE", ondelete="RESTRICT"))
    full_name: Mapped[str]
    phone: Mapped[str]
    role: Mapped[StaffRole] = mapped_column(pg_enum(StaffRole, "StaffRole"))
    shift: Mapped[str | None]
    employee_ref: Mapped[str | None]
    # For a deactivation: the account it is about. For a creation: the account approval made.
    staff_id: Mapped[str | None] = mapped_column(
        ForeignKey("staff.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    reason: Mapped[str | None]  # why to deactivate, or the reviewer's reason for rejecting
    status: Mapped[StaffRequestStatus] = mapped_column(
        pg_enum(StaffRequestStatus, "StaffRequestStatus"),
        server_default="pending",
        default=StaffRequestStatus.pending,
    )
    reviewed_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    review_note: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=utcnow, server_default=text("CURRENT_TIMESTAMP")
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))


class AuditLog(Base):
    """Append-only record of every staff request, decision and account change."""

    __tablename__ = "audit_log"
    __table_args__ = (Index("audit_log_at_idx", "at"),)
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    actor_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    action: Mapped[str]  # e.g. staff_request.created, staff.created, staff.login_locked
    target: Mapped[str | None]
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=utcnow, server_default=text("CURRENT_TIMESTAMP")
    )


class Reservation(Base):
    """Items held for a shopper to collect in a pickup slot. Unpaid: they pay at checkout as usual."""

    __tablename__ = "reservations"
    __table_args__ = (
        Index("reservations_store_slot_idx", "store_id", "slot_start"),
        # One active reservation per shopper, so nobody can lock up stock.
        Index(
            "reservations_one_active_per_user",
            "user_id",
            unique=True,
            postgresql_where=text("status IN ('reserved', 'picked')"),
        ),
    )
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", onupdate="CASCADE", ondelete="RESTRICT"))
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", onupdate="CASCADE", ondelete="RESTRICT"))
    slot_start: Mapped[datetime] = mapped_column(DateTime(timezone=False))
    slot_end: Mapped[datetime] = mapped_column(DateTime(timezone=False))
    status: Mapped[ReservationStatus] = mapped_column(
        pg_enum(ReservationStatus, "ReservationStatus"),
        server_default="reserved",
        default=ReservationStatus.reserved,
    )
    # The cart staff parked the picked items in, which the shopper collects.
    cart_id: Mapped[str | None] = mapped_column(
        ForeignKey("carts.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    picked_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=utcnow, server_default=text("CURRENT_TIMESTAMP")
    )
    picked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))

    items: Mapped[list["ReservationItem"]] = relationship(lazy="selectin", cascade="all, delete-orphan")
    user: Mapped[User] = relationship(foreign_keys=[user_id])


class ReservationItem(Base):
    __tablename__ = "reservation_items"
    reservation_id: Mapped[str] = mapped_column(
        ForeignKey("reservations.id", onupdate="CASCADE", ondelete="CASCADE"), primary_key=True
    )
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.id", onupdate="CASCADE", ondelete="RESTRICT"), primary_key=True
    )
    qty: Mapped[int] = mapped_column(Integer)
    picked_qty: Mapped[int] = mapped_column(Integer, server_default="0", default=0)


class StaffTask(Base):
    """Work for the floor: restock (raised from low stock), pick (from reservations), or other."""

    __tablename__ = "staff_tasks"
    __table_args__ = (Index("staff_tasks_store_status_idx", "store_id", "status"),)
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", onupdate="CASCADE", ondelete="RESTRICT"))
    type: Mapped[TaskType] = mapped_column(pg_enum(TaskType, "TaskType"))
    title: Mapped[str]
    note: Mapped[str | None]
    # A product for restock and stock checks, a reservation for picks.
    ref_id: Mapped[str | None]
    assigned_to: Mapped[str | None] = mapped_column(
        ForeignKey("staff.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    status: Mapped[TaskStatus] = mapped_column(
        pg_enum(TaskStatus, "TaskStatus"), server_default="open", default=TaskStatus.open
    )
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=utcnow, server_default=text("CURRENT_TIMESTAMP")
    )
    done_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))


class StockCorrection(Base):
    """A floor count that disagreed with the system, and the fix (the app-versus-shelf mismatch)."""

    __tablename__ = "stock_corrections"
    __table_args__ = (Index("stock_corrections_store_at_idx", "store_id", "at"),)
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", onupdate="CASCADE", ondelete="RESTRICT"))
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.id", onupdate="CASCADE", ondelete="RESTRICT")
    )
    system_qty: Mapped[int] = mapped_column(Integer)
    counted_qty: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str]
    staff_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=utcnow, server_default=text("CURRENT_TIMESTAMP")
    )


class Offer(Base):
    """A manager's deal on one product for a time window (US-08: aisle deal alerts).

    While it runs, the offer price is the price everywhere: search, the cart and checkout. Managers
    set it; nothing here decides prices on its own.
    """

    __tablename__ = "offers"
    __table_args__ = (Index("offers_store_ends_idx", "store_id", "ends_at"),)
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", onupdate="CASCADE", ondelete="RESTRICT"))
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id", onupdate="CASCADE", ondelete="CASCADE"))
    title: Mapped[str]
    offer_price_paise: Mapped[int] = mapped_column(Integer)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=False))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=False))
    # Set when a manager ends it early.
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=utcnow, server_default=text("CURRENT_TIMESTAMP")
    )


class CartTelemetry(Base):
    """The latest reading from a cart's hardware: battery, the load cell under the basket, the aisle
    beacon it last heard, and any faults it reports. One row per cart, overwritten on every reading.
    In V1 a simulator (smartcart.cart_sim) stands in for the hardware."""

    __tablename__ = "cart_telemetry"
    cart_id: Mapped[str] = mapped_column(
        ForeignKey("carts.id", onupdate="CASCADE", ondelete="CASCADE"), primary_key=True
    )
    battery_pct: Mapped[int] = mapped_column(Integer)
    weight_g: Mapped[int] = mapped_column(Integer)
    aisle: Mapped[str | None]
    faults: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}", default=list)
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), default=utcnow)
    # When the basket's weight stopped matching the scanned items, while it still doesn't.
    mismatch_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))


class SecurityAlert(Base):
    """Something for the floor to check: weight in a cart that was never scanned, or a cart going
    through the exit gate without paying. Staff decide what happened; the system only points."""

    __tablename__ = "security_alerts"
    __table_args__ = (Index("security_alerts_store_status_idx", "store_id", "status"),)
    id: Mapped[str] = mapped_column(primary_key=True, default=new_id)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", onupdate="CASCADE", ondelete="RESTRICT"))
    cart_id: Mapped[str] = mapped_column(ForeignKey("carts.id", onupdate="CASCADE", ondelete="RESTRICT"))
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("cart_sessions.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    kind: Mapped[str]  # unscanned_item | exit_unpaid
    aisle: Mapped[str | None]
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # open | acknowledged | resolved | false_alarm | cleared (the cart matched again by itself)
    status: Mapped[str] = mapped_column(server_default="open", default="open")
    note: Mapped[str | None]
    handled_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", onupdate="CASCADE", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=utcnow, server_default=text("CURRENT_TIMESTAMP")
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
