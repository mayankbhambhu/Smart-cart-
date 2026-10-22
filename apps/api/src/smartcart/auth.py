"""Who is calling. Firebase ID tokens in production; dev tokens until Firebase is set up."""

import asyncio
import re
from dataclasses import dataclass
from typing import Annotated, Protocol

import jwt
from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from . import security
from .errors import ApiError
from .models import Staff, StaffRole, StaffStatus, User, new_id

FIREBASE_JWKS_URL = (
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
)


class AuthError(Exception):
    pass


@dataclass(frozen=True)
class Identity:
    uid: str
    name: str | None = None
    email: str | None = None
    phone: str | None = None


@dataclass(frozen=True)
class AuthUser:
    id: str
    firebase_uid: str
    name: str | None


class TokenVerifier(Protocol):
    async def verify(self, token: str) -> Identity: ...


class FirebaseTokenVerifier:
    """Verifies Firebase Authentication ID tokens against Google's published keys.
    Needs only the project id: no service account or secret."""

    def __init__(self, project_id: str) -> None:
        self.project_id = project_id
        self._jwks = jwt.PyJWKClient(FIREBASE_JWKS_URL, cache_keys=True, lifespan=3600)

    async def verify(self, token: str) -> Identity:
        try:
            key = await asyncio.to_thread(self._jwks.get_signing_key_from_jwt, token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256"],
                audience=self.project_id,
                issuer=f"https://securetoken.google.com/{self.project_id}",
            )
        except jwt.PyJWTError as err:
            raise AuthError("invalid token") from err
        sub = claims.get("sub")
        if not sub:
            raise AuthError("token has no subject")
        return Identity(
            uid=sub, name=claims.get("name"), email=claims.get("email"), phone=claims.get("phone_number")
        )


_DEV_TOKEN = re.compile(r"^dev:([A-Za-z0-9_-]{1,64})(?::(.{1,80}))?$")


class DevTokenVerifier:
    """Development only: accepts "dev:<uid>" or "dev:<uid>:<display name>". Refused in production."""

    async def verify(self, token: str) -> Identity:
        m = _DEV_TOKEN.match(token)
        if not m:
            raise AuthError("invalid dev token")
        return Identity(uid=m.group(1), name=m.group(2))


class SessionTokenVerifier:
    """Accepts the API's own store-team session tokens, and hands every other token to `inner`
    (Firebase, or dev tokens in development)."""

    def __init__(self, secret: str, inner: TokenVerifier) -> None:
        self.secret = secret
        self.inner = inner

    async def verify(self, token: str) -> Identity:
        if not security.is_session_token(token):
            return await self.inner.verify(token)
        try:
            claims = security.read_session(self.secret, token)
        except jwt.PyJWTError as err:
            raise AuthError("invalid session token") from err
        return Identity(uid=claims.uid, name=claims.name)


def bearer_token(header: str | None) -> str | None:
    m = re.match(r"^Bearer\s+(.+)$", header or "", re.IGNORECASE)
    return m.group(1).strip() if m else None


async def upsert_user(db: AsyncSession, identity: Identity) -> AuthUser:
    """Finds or creates the users row for a verified identity."""
    updates = {
        k: v
        for k, v in {"name": identity.name, "email": identity.email, "phone": identity.phone}.items()
        if v
    }
    stmt = (
        insert(User)
        .values(id=new_id(), firebase_uid=identity.uid, **updates)
        .on_conflict_do_update(
            index_elements=[User.firebase_uid], set_=updates or {"firebase_uid": identity.uid}
        )
        .returning(User.id, User.firebase_uid, User.name)
    )
    row = (await db.execute(stmt)).one()
    await db.commit()
    return AuthUser(id=row.id, firebase_uid=row.firebase_uid, name=row.name)


FLOOR = (StaffRole.floor_staff, StaffRole.manager, StaffRole.admin)
MANAGERS = (StaffRole.manager, StaffRole.admin)


async def staff_record(db: AsyncSession, user_id: str, store_id: str | None = None) -> Staff | None:
    """The caller's active store-team account: at this store, or an admin (SmartCart team) anywhere."""
    rows = list(
        await db.scalars(select(Staff).where(Staff.user_id == user_id, Staff.status == StaffStatus.active))
    )
    if store_id is None:
        return next((r for r in rows if r.role == StaffRole.admin), rows[0] if rows else None)
    return next((r for r in rows if r.store_id == store_id), None) or next(
        (r for r in rows if r.role == StaffRole.admin), None
    )


async def is_staff(db: AsyncSession, user_id: str, store_id: str) -> bool:
    return await staff_record(db, user_id, store_id) is not None


async def get_db(request: Request):  # type: ignore[no-untyped-def]
    async with request.app.state.sessionmaker() as session:
        yield session


Db = Annotated[AsyncSession, Depends(get_db)]


async def current_user(request: Request, db: Db) -> AuthUser:
    token = bearer_token(request.headers.get("authorization"))
    if not token:
        raise ApiError(401, "unauthenticated")
    try:
        identity = await request.app.state.verifier.verify(token)
    except AuthError as err:
        raise ApiError(401, "unauthenticated") from err
    return await upsert_user(db, identity)


CurrentUser = Annotated[AuthUser, Depends(current_user)]


async def _require(
    db: AsyncSession, user: AuthUser, store_id: str | None, roles: tuple[StaffRole, ...]
) -> Staff:
    staff = await staff_record(db, user.id, store_id)
    if staff is None or staff.role not in roles:
        raise ApiError(403, "forbidden")
    if staff.must_change_password:
        raise ApiError(403, "password_change_required")
    return staff


async def floor_staff(store_id: str, user: CurrentUser, db: Db) -> Staff:
    """Anyone on the store team at the route's {store_id}: the handheld's staff mode."""
    return await _require(db, user, store_id, FLOOR)


async def manager(store_id: str, user: CurrentUser, db: Db) -> Staff:
    """Floor or store manager at the route's {store_id}: the manager dashboard."""
    return await _require(db, user, store_id, MANAGERS)


async def admin(user: CurrentUser, db: Db) -> Staff:
    """The SmartCart admin team, who approve store-team accounts for every store."""
    return await _require(db, user, None, (StaffRole.admin,))


FloorStaff = Annotated[Staff, Depends(floor_staff)]
Manager = Annotated[Staff, Depends(manager)]
Admin = Annotated[Staff, Depends(admin)]
