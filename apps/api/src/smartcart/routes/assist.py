"""Find it fast (milestone 4): search, smart list, Ask SmartCart and floor help."""

from typing import Annotated, Any

from fastapi import APIRouter, Query, Request

from ..assist_service import AssistService
from ..assistant import Assistant
from ..auth import CurrentUser, Db, StaffUser
from ..schemas import AskRequest, HelpActionRequest, HelpCreateRequest, RouteListRequest

router = APIRouter(prefix="/v1/stores/{store_id}")
admin_router = APIRouter(prefix="/admin/v1/stores/{store_id}")


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
) -> dict[str, Any]:
    """Search by name, brand or category (Hindi words like haldi or chawal work too), optionally
    filtered by diet. Each result says where it is and whether it is in stock."""
    results = await _assist(request).search(db, store_id, q, diet=diet, limit=limit)
    return {"query": q, "results": results}


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
    store_id: str, _: StaffUser, request: Request, db: Db, openOnly: bool = True
) -> dict[str, Any]:
    """Help requests for staff screens, newest first: open ones, or everything from the last day."""
    return {
        "storeId": store_id,
        "requests": await _assist(request).store_help(db, store_id, open_only=openOnly),
    }


@admin_router.post("/help/{request_id}")
async def staff_help_action(
    store_id: str, request_id: str, body: HelpActionRequest, user: StaffUser, request: Request, db: Db
) -> dict[str, Any]:
    view = await _assist(request).update_help(
        db, store_id=store_id, request_id=request_id, action=body.action, actor_id=user.id, staff=True
    )
    return view.wire()


@admin_router.get("/insights")
async def insights(store_id: str, _: StaffUser, request: Request, db: Db, days: int = 7) -> dict[str, Any]:
    """What shoppers searched for and didn't find, and how floor help is going."""
    return await _assist(request).insights(db, store_id, days)
