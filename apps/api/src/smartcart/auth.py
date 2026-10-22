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

from .errors import ApiError
from .models import Staff, User, new_id

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


async def is_staff(db: AsyncSession, user_id: str, store_id: str) -> bool:
    found = await db.scalar(select(Staff.id).where(Staff.user_id == user_id, Staff.store_id == store_id))
    return found is not None


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


async def staff_user(store_id: str, user: CurrentUser, db: Db) -> AuthUser:
    """Requires the caller to be staff at the route's {store_id}."""
    if not await is_staff(db, user.id, store_id):
        raise ApiError(403, "forbidden")
    return user


StaffUser = Annotated[AuthUser, Depends(staff_user)]
