"""Payment providers behind one interface, so Stripe can be swapped (Razorpay for UPI) or faked.

An order is paid only when the provider says so: Stripe through its signed webhook, the fake
provider through an explicit confirm call that exists only in development.
"""

import json
import uuid
from dataclasses import dataclass
from typing import Literal, Protocol

import stripe

from .config import Settings

ProviderName = Literal["fake", "stripe"]


@dataclass(frozen=True)
class CreatedPayment:
    provider_payment_id: str
    client_secret: str | None


@dataclass(frozen=True)
class PaymentUpdate:
    """A provider's verified statement about one payment."""

    provider_payment_id: str
    status: Literal["succeeded", "failed"]
    raw: dict[str, object]


class PaymentError(Exception):
    pass


class PaymentProvider(Protocol):
    name: ProviderName
    publishable_key: str | None

    async def create(
        self, *, order_id: str, amount_paise: int, store_id: str, attempt: int
    ) -> CreatedPayment: ...

    def parse_webhook(self, payload: bytes, signature: str | None) -> PaymentUpdate | None:
        """Verifies a webhook and returns the payment update in it, or None if it is not one we act on.
        Raises PaymentError if the signature is invalid."""
        ...


class FakeProvider:
    """Development only: payments succeed when the app calls the confirm endpoint. Refused in production."""

    name: ProviderName = "fake"
    publishable_key: str | None = None

    async def create(
        self, *, order_id: str, amount_paise: int, store_id: str, attempt: int
    ) -> CreatedPayment:
        return CreatedPayment(provider_payment_id=f"fake_{uuid.uuid4().hex}", client_secret=None)

    def parse_webhook(self, payload: bytes, signature: str | None) -> PaymentUpdate | None:
        raise PaymentError("the fake provider has no webhooks")


class StripeProvider:
    """Stripe PaymentIntents in INR. The app collects the card or UPI details with Stripe's
    PaymentSheet; we learn the outcome from the payment_intent.* webhooks."""

    name: ProviderName = "stripe"

    def __init__(self, secret_key: str, webhook_secret: str, publishable_key: str) -> None:
        self.client = stripe.StripeClient(secret_key, http_client=stripe.HTTPXClient())
        self.webhook_secret = webhook_secret
        self.publishable_key: str | None = publishable_key

    async def create(
        self, *, order_id: str, amount_paise: int, store_id: str, attempt: int
    ) -> CreatedPayment:
        try:
            intent = await self.client.v1.payment_intents.create_async(
                params={
                    "amount": amount_paise,
                    "currency": "inr",
                    "automatic_payment_methods": {"enabled": True},
                    "metadata": {"order_id": order_id, "store_id": store_id},
                },
                # A retried request must not create a second PaymentIntent; a new attempt (after
                # "back to cart" changed the amount) must.
                options={"idempotency_key": f"order-{order_id}-{attempt}"},
            )
        except stripe.StripeError as err:
            raise PaymentError(str(err)) from err
        return CreatedPayment(provider_payment_id=intent.id, client_secret=intent.client_secret)

    def parse_webhook(self, payload: bytes, signature: str | None) -> PaymentUpdate | None:
        try:
            evt = stripe.Webhook.construct_event(payload, signature, self.webhook_secret)
        except (ValueError, stripe.SignatureVerificationError) as err:
            raise PaymentError("invalid webhook signature") from err
        status = {"payment_intent.succeeded": "succeeded", "payment_intent.payment_failed": "failed"}.get(
            evt.type
        )
        if status is None:
            return None
        raw: dict[str, object] = json.loads(payload)
        return PaymentUpdate(provider_payment_id=evt.data.object["id"], status=status, raw=raw)  # type: ignore[arg-type]


def make_provider(settings: Settings) -> PaymentProvider:
    if settings.payment_provider == "stripe":
        key, hook, publishable = (
            settings.stripe_secret_key,
            settings.stripe_webhook_secret,
            settings.stripe_publishable_key,
        )
        assert key and hook and publishable  # Settings refuses to start without them
        return StripeProvider(key, hook, publishable)
    return FakeProvider()
