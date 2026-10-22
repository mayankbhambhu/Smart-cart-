"""Find it fast (milestone 4): search, smart list, Ask SmartCart and floor help."""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request

from ..assist_service import AssistService
from ..assistant import Assistant
from ..auth import CurrentUser, Db, Manager
from ..schemas import (
    AskRequest,
    HelpActionRequest,
    HelpCreateRequest,
    ProductLabelRequest,
    RouteListRequest,
)

router = APIRouter(prefix="/v1/stores/{store_id}")
catalog_router = APIRouter(prefix="/v1")
admin_router = APIRouter(prefix="/admin/v1/stores/{store_id}")


StoreParam = Annotated[str, Query(alias="storeId")]


def _split(values: list[str] | None) -> list[str]:
    return [v for x in values or [] for v in x.split(",") if v]


def _assist(request: Request) -> AssistService:
    service: AssistService = request.app.state.assist
    return service


@router.get("/products/search")
async def search(
    store_id: str,
    request: Request,
    db: Db,
    q: str,
    diet: Annotated[list[str] | None, Query()] = None,
    limit: int = 20,
    source: Literal["search", "voice"] = "search",
) -> dict[str, Any]:
    """Search by name, brand or category, optionally filtered by diet. Each result says where it is
    and whether it is in stock. Hindi works typed in Latin (haldi, chawal) or Devanagari (हल्दी), and
    spoken questions ("doodh kahan milega") are reduced to their item words. source=voice marks a
    spoken search in the report."""
    results = await _assist(request).search(db, store_id, q, diet=diet, limit=limit, source=source)
    return {"query": q, "results": results}


@catalog_router.get("/sections")
async def sections(request: Request, db: Db, store_id: StoreParam = "S-01") -> dict[str, Any]:
    """Browsing sections (Fruits, Dairy and eggs, ...) with their categories and product counts."""
    return {"storeId": store_id, "sections": await _assist(request).sections(db, store_id)}


@catalog_router.get("/products")
async def browse(
    request: Request,
    db: Db,
    store_id: StoreParam = "S-01",
    section: str | None = None,
    category: str | None = None,
    food_type: Annotated[list[str] | None, Query()] = None,
    tags: Annotated[list[str] | None, Query()] = None,
) -> dict[str, Any]:
    """A section's or category's products, optionally only veg (food_type=veg) or Jain (tags=jain).
    food_type and tags may repeat or be comma separated."""
    results = await _assist(request).browse(
        db, store_id, section=section, category=category, food_types=_split(food_type), tags=_split(tags)
    )
    return {"storeId": store_id, "section": section, "category": category, "results": results}


@admin_router.patch("/catalog/products/{product_id}")
async def label_product(
    store_id: str, product_id: str, body: ProductLabelRequest, staff: Manager, request: Request, db: Db
) -> dict[str, Any]:
    """Correct a product's category or food label from its pack. Recorded in the audit log."""
    return await _assist(request).label_product(db, product_id, staff.user_id, body.wire())


@router.post("/lists/route")
async def route_list(store_id: str, body: RouteListRequest, request: Request, db: Db) -> dict[str, Any]:
    """A shopping list sorted into a walking route through the store."""
    return await _assist(request).route_list(db, store_id, body.lines)


@router.post("/assistant")
async def ask(store_id: str, body: AskRequest, request: Request, _: CurrentUser, db: Db) -> dict[str, Any]:
    """Ask SmartCart. Signed-in shoppers only, so the AI cannot be used anonymously."""
    assistant: Assistant = request.app.state.assistant
    history = [t.model_dump() for t in body.history]
    return await assistant.answer(db, store_id, body.message, history)


@router.post("/help", status_code=201)
async def request_help(
    store_id: str, body: HelpCreateRequest, request: Request, user: CurrentUser, db: Db
) -> dict[str, Any]:
    view = await _assist(request).request_help(
        db, store_id=store_id, user_id=user.id, user_name=user.name, topic=body.topic, note=body.note
    )
    return view.wire()


@router.get("/help/mine")
async def my_help(store_id: str, request: Request, user: CurrentUser, db: Db) -> dict[str, Any]:
    return {"request": await _assist(request).my_help(db, store_id, user.id)}


@router.post("/help/{request_id}")
async def shopper_help_action(
    store_id: str, request_id: str, body: HelpActionRequest, request: Request, user: CurrentUser, db: Db
) -> dict[str, Any]:
    view = await _assist(request).update_help(
        db, store_id=store_id, request_id=request_id, action=body.action, actor_id=user.id, staff=False
    )
    return view.wire()


@admin_router.get("/help")
async def store_help(
    store_id: str, _: Manager, request: Request, db: Db, openOnly: bool = True
) -> dict[str, Any]:
    """Help requests for staff screens, newest first: open ones, or everything from the last day."""
    return {
        "storeId": store_id,
        "requests": await _assist(request).store_help(db, store_id, open_only=openOnly),
    }


@admin_router.post("/help/{request_id}")
async def staff_help_action(
    store_id: str, request_id: str, body: HelpActionRequest, user: Manager, request: Request, db: Db
) -> dict[str, Any]:
    view = await _assist(request).update_help(
        db, store_id=store_id, request_id=request_id, action=body.action, actor_id=user.user_id, staff=True
    )
    return view.wire()


@admin_router.get("/insights")
async def insights(store_id: str, _: Manager, request: Request, db: Db, days: int = 7) -> dict[str, Any]:
    """What shoppers searched for and didn't find, and how floor help is going."""
    return await _assist(request).insights(db, store_id, days)
