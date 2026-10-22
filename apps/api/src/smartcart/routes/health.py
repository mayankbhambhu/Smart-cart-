import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

router = APIRouter()


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness: the process is up. Used by the ECS container health check."""
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(request: Request) -> JSONResponse:
    """Readiness: Postgres and Redis both answer. Used by the load balancer target group."""

    async def db_ok() -> None:
        async with request.app.state.sessionmaker() as db:
            await db.execute(text("SELECT 1"))

    db: object
    cache: object
    db, cache = await asyncio.gather(db_ok(), request.app.state.redis.ping(), return_exceptions=True)
    checks = {
        "postgres": "down" if isinstance(db, BaseException) else "ok",
        "redis": "down" if isinstance(cache, BaseException) else "ok",
    }
    ok = all(v == "ok" for v in checks.values())
    return JSONResponse(
        {"status": "ok" if ok else "degraded", "checks": checks}, status_code=200 if ok else 503
    )
