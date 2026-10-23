"""Store analytics (milestone 7): the manager's Analytics page."""

from typing import Annotated, Any

from fastapi import APIRouter, Query

from .. import analytics
from ..auth import Db, Manager

admin_router = APIRouter(prefix="/admin/v1/stores/{store_id}")


@admin_router.get("/analytics")
async def store_analytics(
    store_id: str, _: Manager, db: Db, days: Annotated[int, Query(ge=1, le=analytics.MAX_DAYS)] = 7
) -> dict[str, Any]:
    """Sales by hour and day (IST), basket size, top products, category mix, deal uplift, voice
    searches, busy aisles and security alerts, for the last `days` days."""
    return await analytics.load(db, store_id, days)
