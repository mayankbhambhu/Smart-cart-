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
