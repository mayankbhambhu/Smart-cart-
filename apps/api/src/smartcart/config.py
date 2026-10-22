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
    # Use the Socket.IO Redis manager so any API instance can deliver to any room.
    realtime_redis: bool = True

    @model_validator(mode="after")
    def _check(self) -> "Settings":
        if self.auth_mode == "firebase" and not self.firebase_project_id:
            raise ValueError("FIREBASE_PROJECT_ID is required when AUTH_MODE=firebase")
        if self.env == "production" and self.auth_mode == "dev":
            raise ValueError("AUTH_MODE=dev is not allowed in production")
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
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
