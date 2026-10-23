from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment configuration. Values come from the environment or apps/api/.env."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: Literal["development", "test", "production"] = "development"
    port: int = 4000
    host: str = "0.0.0.0"
    log_level: str = "info"
    database_url: str = "postgresql://smartcart:smartcart@localhost:5432/smartcart"
    redis_url: str = "redis://localhost:6379"
    # Comma-separated list of origins allowed to call the API from a browser.
    cors_origins: str = "http://localhost:3000"
    # firebase: verify Firebase ID tokens. dev: trust "dev:<uid>[:name]" tokens so the app can be
    # tested before Firebase is set up. dev is refused in production.
    auth_mode: Literal["firebase", "dev"] = "dev"
    firebase_project_id: str | None = None
    # Minutes a cart session can sit idle before it is abandoned and its reservations released.
    cart_idle_minutes: int = 30
    # fake: payments complete via a confirm call, for development. stripe: Stripe PaymentIntents.
    # The Stripe keys come from the environment (Secrets Manager in AWS), never from code or chat.
    payment_provider: Literal["fake", "stripe"] = "fake"
    stripe_secret_key: str | None = None
    stripe_publishable_key: str | None = None
    stripe_webhook_secret: str | None = None
    # Ask SmartCart uses Claude when this is set; without it the assistant answers by rules from the
    # same store facts. From the environment (Secrets Manager in AWS), never from code or chat.
    anthropic_api_key: str | None = None
    # Signs the session tokens the API issues to store-team members after a password sign-in.
    # At least 32 random characters, from the environment; a fixed dev value is used outside production.
    session_secret: str | None = None
    # How staff get their temporary password by SMS. "log" writes it to the API log and returns it to
    # the approving admin, for development and demos only; a real SMS provider is still to be chosen.
    sms_provider: Literal["log"] = "log"
    # Carts and exit gates sign their readings with a key derived from this (see cart_guard). At least
    # 32 random characters from the environment in production; a fixed dev value is used otherwise.
    cart_device_secret: str | None = None
    # Use the Socket.IO Redis manager so any API instance can deliver to any room.
    realtime_redis: bool = True

    @model_validator(mode="after")
    def _check(self) -> "Settings":
        if self.auth_mode == "firebase" and not self.firebase_project_id:
            raise ValueError("FIREBASE_PROJECT_ID is required when AUTH_MODE=firebase")
        if self.env == "production" and self.auth_mode == "dev":
            raise ValueError("AUTH_MODE=dev is not allowed in production")
        if self.payment_provider == "stripe" and not (
            self.stripe_secret_key and self.stripe_publishable_key and self.stripe_webhook_secret
        ):
            raise ValueError(
                "PAYMENT_PROVIDER=stripe needs STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY "
                "and STRIPE_WEBHOOK_SECRET"
            )
        if self.env == "production" and (not self.session_secret or len(self.session_secret) < 32):
            raise ValueError("SESSION_SECRET (32+ characters) is required in production")
        if self.env == "production" and (not self.cart_device_secret or len(self.cart_device_secret) < 32):
            raise ValueError("CART_DEVICE_SECRET (32+ characters) is required in production")
        if self.env == "production" and self.payment_provider == "fake":
            raise ValueError("PAYMENT_PROVIDER=fake is not allowed in production")
        if self.env == "production" and self.sms_provider == "log":
            raise ValueError("SMS_PROVIDER=log is not allowed in production")
        return self

    @property
    def async_database_url(self) -> str:
        """SQLAlchemy URL using the asyncpg driver; accepts plain postgresql:// URLs."""
        url = self.database_url.split("?")[0]
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+asyncpg://" + url[len(prefix) :]
        return url

    @property
    def signing_secret(self) -> str:
        return self.session_secret or "dev-only-session-secret-not-for-production"

    @property
    def device_secret(self) -> str:
        return self.cart_device_secret or "dev-only-cart-device-secret-not-for-production"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
