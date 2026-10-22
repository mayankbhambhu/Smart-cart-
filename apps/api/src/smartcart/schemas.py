"""Wire format shared with the apps. Mirrors packages/contracts (zod); tests/test_contracts.py
validates these models' output against the JSON Schemas exported from there, so the two
cannot drift apart unnoticed."""

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class Wire(BaseModel):
    """camelCase on the wire, snake_case in Python."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    def wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, mode="json")


class CartLine(Wire):
    product_id: str
    name: str
    brand: str | None
    image_url: str | None
    qty: int
    unit_price_paise: int
    gst_rate_bp: int
    line_total_paise: int
    line_tax_paise: int


class CartTotals(Wire):
    # Sum of line totals, GST inclusive (Indian retail prices are tax inclusive).
    total_paise: int
    # GST portion contained in total_paise.
    tax_paise: int
    subtotal_paise: int
    item_count: int


SessionStatus = Literal["active", "checking_out", "paid", "abandoned"]


class CartSnapshot(Wire):
    session_id: str
    cart_code: str
    store_id: str
    status: SessionStatus
    lines: list[CartLine]
    totals: CartTotals
    updated_at: str


class LineChange(Wire):
    """REST answer to an add or remove: the changed line (None if it left the cart) and new totals."""

    line: CartLine | None
    totals: CartTotals


class PairCartRequest(Wire):
    cart_code: str = Field(pattern=r"^C-\d{4,}$")
    store_id: str = Field(pattern=r"^S-\d{2,}$")


class AddItemRequest(Wire):
    barcode: str = Field(pattern=r"^\d{8,14}$")
    qty: int = Field(default=1, ge=1, le=50)
    # Client-generated id so a retried request is applied once.
    request_id: uuid.UUID


Source = Literal["phone", "cart", "system", "staff"]


def event(
    type_: str, *, store_id: str, cart_id: str | None, source: Source, data: dict[str, Any]
) -> dict[str, Any]:
    """Builds an event in the shared envelope. Every real-time event goes through here.

    `source` is how V2 slots in: the cart hardware publishes the same events with source "cart".
    """
    return {
        "type": type_,
        "eventId": str(uuid.uuid4()),
        "storeId": store_id,
        "cartId": cart_id,
        "source": source,
        "occurredAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "data": data,
    }


def cart_room(session_id: str) -> str:
    return f"cart:{session_id}"


def store_room(store_id: str) -> str:
    return f"store:{store_id}"


# --- orders and payments (packages/contracts/src/order.ts) ---

OrderStatusName = Literal["pending_payment", "paid", "cancelled", "refunded"]
ProviderName = Literal["fake", "stripe"]


class GstSummaryRow(Wire):
    gst_rate_bp: int
    taxable_paise: int
    tax_paise: int


class Receipt(Wire):
    order_id: str
    session_id: str
    store_id: str
    store_name: str
    cart_code: str
    status: OrderStatusName
    lines: list[CartLine]
    totals: CartTotals
    gst_summary: list[GstSummaryRow]
    exit_code: str | None
    exit_qr: str | None
    exit_used_at: str | None
    created_at: str


class PaymentIntentOut(Wire):
    provider: ProviderName
    payment_id: str
    client_secret: str | None
    publishable_key: str | None


class CheckoutResponse(Wire):
    order: Receipt
    payment: PaymentIntentOut


class ExitCheckRequest(Wire):
    code: str = Field(min_length=4, max_length=200)


class ExitCheckResponse(Wire):
    result: Literal["ok", "already_used", "not_paid", "not_found"]
    order: Receipt | None


# ---- Milestone 4: find it fast ----------------------------------------------------------------


class RouteListRequest(Wire):
    lines: list[str] = Field(min_length=1, max_length=60)


HelpTopic = Literal["find_item", "price", "stock", "other"]


class HelpCreateRequest(Wire):
    topic: HelpTopic = "find_item"
    note: str | None = Field(default=None, max_length=200)


class HelpActionRequest(Wire):
    action: Literal["acknowledge", "resolve", "cancel"]


class ChatTurn(Wire):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=2000)


class AskRequest(Wire):
    message: str = Field(min_length=1, max_length=500)
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)
