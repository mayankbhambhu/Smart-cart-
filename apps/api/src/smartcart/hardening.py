"""Pilot hardening (milestone 7): rate limits, request ids, structured logs and optional error tracking.

Rate limits are fixed one-minute windows counted in Redis, so every API instance shares them. They
protect the routes that are worth abusing: sign-in (password guessing), the assistant (it costs money
per call), search, help requests and the cart hardware. If Redis is unreachable the request goes
through: a shop floor that can't scan is worse than a missed limit.
"""

import contextvars
import hashlib
import json
import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

log = logging.getLogger("smartcart")
access = logging.getLogger("smartcart.access")
request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)


@dataclass(frozen=True)
class Rule:
    name: str
    method: str
    path: re.Pattern[str]
    limit: int  # requests per window, per caller
    window_s: int = 60
    # Who a request counts against: the signed-in caller (else the address), the address, or the device.
    by: str = "caller"


def default_rules(scale: float = 1.0) -> list[Rule]:
    """Limits sized for one shopper or one cart; `scale` raises or lowers all of them."""

    def r(name: str, method: str, path: str, limit: int, by: str = "caller") -> Rule:
        return Rule(name, method, re.compile(path), max(1, round(limit * scale)), by=by)

    return [
        r("staff_login", "POST", r"^/v1/auth/staff/login$", 10, by="ip"),
        r("staff_password", "POST", r"^/v1/auth/staff/password$", 10),
        r("assistant", "POST", r"^/v1/stores/[^/]+/assistant$", 20),
        r("search", "GET", r"^/v1/stores/[^/]+/products/search$", 120),
        r("help", "POST", r"^/v1/stores/[^/]+/help$", 10),
        # A cart reports every few seconds; a gate once per cart passing. Keyed by the device in the path.
        r("hardware", "POST", r"^/hw/v1/", 240, by="device"),
    ]


class RateLimiter:
    def __init__(self, redis: Redis, rules: list[Rule], *, enabled: bool = True, proxy_hops: int = 0) -> None:
        self.redis = redis
        self.rules = rules
        self.enabled = enabled
        self.proxy_hops = proxy_hops

    def client_ip(self, request: Request) -> str:
        """The caller's address. Behind a load balancer, the one it saw (X-Forwarded-For, from the right)."""
        if self.proxy_hops:
            hops = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",") if h.strip()]
            if len(hops) >= self.proxy_hops:
                return hops[-self.proxy_hops]
        return request.client.host if request.client else "unknown"

    def _key(self, rule: Rule, request: Request) -> str:
        if rule.by == "device":
            who = request.url.path
        elif rule.by == "caller" and (auth := request.headers.get("authorization")):
            who = "auth:" + hashlib.sha256(auth.encode()).hexdigest()[:20]
        else:
            who = "ip:" + self.client_ip(request)
        window = int(time.time()) // rule.window_s
        return f"ratelimit:{rule.name}:{who}:{window}"

    async def check(self, request: Request) -> JSONResponse | None:
        """None to let the request through, or the 429 to send instead."""
        if not self.enabled:
            return None
        rule = next(
            (r for r in self.rules if r.method == request.method and r.path.search(request.url.path)), None
        )
        if rule is None:
            return None
        key = self._key(rule, request)
        try:
            async with self.redis.pipeline(transaction=True) as pipe:
                pipe.incr(key)
                pipe.expire(key, rule.window_s + 1)
                count, _ = await pipe.execute()
        except Exception:
            log.warning(
                "rate limit check failed for %s; letting the request through", rule.name, exc_info=True
            )
            return None
        if int(count) <= rule.limit:
            return None
        retry = rule.window_s - int(time.time()) % rule.window_s
        log.warning("rate limited %s (%s)", rule.name, request.url.path)
        return JSONResponse(
            {"error": "rate_limited", "retryAfterSeconds": retry},
            status_code=429,
            headers={"retry-after": str(retry)},
        )


async def request_context(
    request: Request, call_next: Callable[[Request], Awaitable[Response]], limiter: RateLimiter
) -> Response:
    """Gives every request an id (kept from X-Request-ID if the caller sent a sane one), applies the
    rate limits, and writes one access log line with the outcome and timing."""
    incoming = request.headers.get("x-request-id", "")
    rid = incoming if re.fullmatch(r"[A-Za-z0-9._-]{8,64}", incoming) else uuid.uuid4().hex
    token = request_id.set(rid)
    started = time.perf_counter()
    status = 500
    try:
        limited = await limiter.check(request)
        response = limited or await call_next(request)
        status = response.status_code
        response.headers["x-request-id"] = rid
        return response
    finally:
        access.info(
            "%s %s %d",
            request.method,
            request.url.path,
            status,
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": status,
                "ms": round((time.perf_counter() - started) * 1000, 1),
            },
        )
        request_id.reset(token)


class JsonFormatter(logging.Formatter):
    """One JSON object per line, for CloudWatch or any log search. Never logs request bodies."""

    FIELDS = ("method", "path", "status", "ms")

    def format(self, record: logging.LogRecord) -> str:
        out: dict[str, Any] = {
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        if rid := request_id.get():
            out["requestId"] = rid
        for f in self.FIELDS:
            if hasattr(record, f):
                out[f] = getattr(record, f)
        if record.exc_info:
            out["error"] = self.formatException(record.exc_info)
        return json.dumps(out, ensure_ascii=False)


def configure_logging(level: str, fmt: str) -> None:
    """json in production (one object per line); text for reading in a terminal."""
    handler = logging.StreamHandler()
    if fmt == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root = logging.getLogger("smartcart")
    root.handlers = [handler]
    root.setLevel(level.upper())
    root.propagate = False


def init_error_tracking(dsn: str | None, env: str, release: str) -> bool:
    """Sends unhandled errors to Sentry when SENTRY_DSN is set. No personal data: no request bodies,
    no cookies, no user details. Returns whether it is on."""
    if not dsn:
        return False
    import sentry_sdk

    def scrub(event: Any, _hint: Any) -> Any:
        req = event.get("request") or {}
        req.pop("data", None)
        req.pop("cookies", None)
        if headers := req.get("headers"):
            for h in list(headers):
                if h.lower() in ("authorization", "x-device-key", "cookie"):
                    headers[h] = "[removed]"
        if rid := request_id.get():
            event.setdefault("tags", {})["request_id"] = rid
        return event

    sentry_sdk.init(
        dsn=dsn,
        environment=env,
        release=release,
        traces_sample_rate=0.0,
        before_send=scrub,
    )
    return True
