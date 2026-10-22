"""Store-team accounts: password sign-in, and the request-and-approve flow that creates and
deactivates them.

No store-team account is self-registered. A manager raises a request; the SmartCart admin team
approves, rejects or sends it back; approving a new account creates the staff ID, registers the
phone and texts a temporary password, which must be changed at first sign-in. Deactivating someone
suspends their sign-in at once and becomes permanent on approval. Every step lands in audit_log.
"""

import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import security
from .errors import ApiError
from .models import (
    AuditLog,
    Staff,
    StaffRequest,
    StaffRequestStatus,
    StaffRequestType,
    StaffRole,
    StaffStatus,
    Store,
    User,
    utcnow,
)

log = logging.getLogger("smartcart.staff")


def _iso(dt: Any) -> str | None:
    return dt.isoformat() + "Z" if dt else None


def mask_phone(phone: str | None) -> str | None:
    return f"{phone[:3]} ••••• {phone[-5:]}" if phone and len(phone) > 8 else phone


def staff_wire(s: Staff) -> dict[str, Any]:
    return {
        "id": s.id,
        "staffCode": s.staff_code,
        "name": s.full_name or (s.user.name if s.user else None),
        "phone": s.phone,
        "role": s.role.value,
        "storeId": s.store_id,
        "shift": s.shift,
        "status": s.status.value,
        "mustChangePassword": s.must_change_password,
        "createdAt": _iso(s.created_at),
    }


def request_wire(r: StaffRequest, names: dict[str, str | None]) -> dict[str, Any]:
    return {
        "id": r.id,
        "type": r.type.value,
        "storeId": r.store_id,
        "fullName": r.full_name,
        "phone": r.phone,
        "role": r.role.value,
        "shift": r.shift,
        "employeeRef": r.employee_ref,
        "staffId": r.staff_id,
        "reason": r.reason,
        "status": r.status.value,
        "requestedBy": names.get(r.requested_by),
        "reviewedBy": names.get(r.reviewed_by) if r.reviewed_by else None,
        "reviewNote": r.review_note,
        "createdAt": _iso(r.created_at),
        "decidedAt": _iso(r.decided_at),
    }


class StaffService:
    def __init__(self, secret: str, sms_provider: str) -> None:
        self.secret = secret
        self.sms_provider = sms_provider

    # ---- sign-in -------------------------------------------------------------------------------

    async def login(self, db: AsyncSession, login: str, password: str) -> dict[str, Any]:
        """Staff ID or registered phone, plus password. Five wrong tries lock the account for 15
        minutes. Errors never say whether the account exists."""
        login = login.strip()
        phone = security.normalise_phone(login)
        stmt = (
            select(Staff).where(Staff.phone == phone)
            if phone
            else select(Staff).where(func.upper(Staff.staff_code) == login.upper())
        )
        staff = await db.scalar(stmt)
        now = utcnow()
        if staff is None:
            security.verify_password(None, password)
            raise ApiError(401, "invalid_credentials")
        if staff.locked_until and staff.locked_until > now:
            raise ApiError(
                423, "account_locked", retryAfterSeconds=int((staff.locked_until - now).total_seconds())
            )
        if not security.verify_password(staff.password_hash, password):
            staff.failed_logins += 1
            if staff.failed_logins >= security.MAX_FAILED_LOGINS:
                staff.failed_logins = 0
                staff.locked_until = now + timedelta(minutes=security.LOCK_MINUTES)
                self._audit(db, None, "staff.login_locked", staff.id)
            await db.commit()
            raise ApiError(401, "invalid_credentials")
        if staff.status != StaffStatus.active:
            raise ApiError(403, "account_inactive")
        if (
            staff.must_change_password
            and staff.temp_password_expires_at
            and staff.temp_password_expires_at < now
        ):
            raise ApiError(403, "temporary_password_expired")
        staff.failed_logins = 0
        staff.locked_until = None
        user = await db.get(User, staff.user_id)
        assert user
        await db.commit()
        token, expires = security.issue_session(self.secret, user.firebase_uid, user.name, staff.id)
        return {
            "token": token,
            "expiresAt": expires.isoformat().replace("+00:00", "Z"),
            "mustChangePassword": staff.must_change_password,
            "staff": staff_wire(staff),
        }

    async def change_password(self, db: AsyncSession, user_id: str, current: str, new: str) -> dict[str, Any]:
        staff = await db.scalar(
            select(Staff).where(Staff.user_id == user_id, Staff.status == StaffStatus.active)
        )
        if staff is None:
            raise ApiError(403, "forbidden")
        if not security.verify_password(staff.password_hash, current):
            raise ApiError(400, "wrong_password")
        if problem := security.password_problem(new):
            raise ApiError(400, problem)
        if new == current:
            raise ApiError(400, "password_unchanged")
        staff.password_hash = security.hash_password(new)
        staff.must_change_password = False
        staff.temp_password_expires_at = None
        self._audit(db, user_id, "staff.password_changed", staff.id)
        await db.commit()
        return staff_wire(staff)

    async def me(self, db: AsyncSession, user_id: str) -> dict[str, Any]:
        """Which side of the app this person gets. The server's role, never the login tab, decides."""
        rows = list(await db.scalars(select(Staff).where(Staff.user_id == user_id)))
        active = [r for r in rows if r.status == StaffStatus.active]
        staff = next((r for r in active if r.role == StaffRole.admin), active[0] if active else None)
        if staff is None:
            return {"side": "shopper", "role": "shopper", "staff": None}
        return {"side": "store", "role": staff.role.value, "staff": staff_wire(staff)}

    # ---- requests (manager) --------------------------------------------------------------------

    async def request_create(
        self, db: AsyncSession, store_id: str, manager_user_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        phone = security.normalise_phone(body["phone"])
        if phone is None:
            raise ApiError(400, "invalid_phone")
        await self._assert_phone_free(db, phone)
        req = StaffRequest(
            type=StaffRequestType.create,
            store_id=store_id,
            requested_by=manager_user_id,
            full_name=body["fullName"].strip(),
            phone=phone,
            role=StaffRole(body["role"]),
            shift=(body.get("shift") or "").strip() or None,
            employee_ref=(body.get("employeeRef") or "").strip() or None,
        )
        db.add(req)
        await db.flush()
        self._audit(db, manager_user_id, "staff_request.created", req.id, {"type": "create", "phone": phone})
        await db.commit()
        return await self._wire(db, req)

    async def request_deactivate(
        self, db: AsyncSession, store_id: str, manager_user_id: str, staff_id: str, reason: str
    ) -> dict[str, Any]:
        staff = await db.get(Staff, staff_id)
        if staff is None or staff.store_id != store_id or staff.role == StaffRole.admin:
            raise ApiError(404, "staff_not_found")
        if staff.user_id == manager_user_id:
            raise ApiError(400, "cannot_deactivate_self")
        if staff.status != StaffStatus.active:
            raise ApiError(409, "staff_not_active")
        req = StaffRequest(
            type=StaffRequestType.deactivate,
            store_id=store_id,
            requested_by=manager_user_id,
            full_name=staff.full_name or "",
            phone=staff.phone or "",
            role=staff.role,
            shift=staff.shift,
            staff_id=staff.id,
            reason=reason.strip(),
        )
        # Suspended at once, so a leaver cannot keep using the system while the request waits.
        staff.status = StaffStatus.suspended
        db.add(req)
        await db.flush()
        self._audit(
            db, manager_user_id, "staff_request.created", req.id, {"type": "deactivate", "staffId": staff.id}
        )
        self._audit(db, manager_user_id, "staff.suspended", staff.id)
        await db.commit()
        return await self._wire(db, req)

    async def resubmit(
        self, db: AsyncSession, store_id: str, request_id: str, manager_user_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        """A manager fixes a request the admin team sent back for changes."""
        req = await db.get(StaffRequest, request_id)
        if req is None or req.store_id != store_id or req.type != StaffRequestType.create:
            raise ApiError(404, "staff_request_not_found")
        if req.status != StaffRequestStatus.changes_requested:
            raise ApiError(409, "staff_request_not_editable")
        phone = security.normalise_phone(body["phone"])
        if phone is None:
            raise ApiError(400, "invalid_phone")
        await self._assert_phone_free(db, phone, ignore_request=req.id)
        req.full_name = body["fullName"].strip()
        req.phone = phone
        req.role = StaffRole(body["role"])
        req.shift = (body.get("shift") or "").strip() or None
        req.employee_ref = (body.get("employeeRef") or "").strip() or None
        req.status = StaffRequestStatus.pending
        self._audit(db, manager_user_id, "staff_request.resubmitted", req.id)
        await db.commit()
        return await self._wire(db, req)

    async def store_requests(self, db: AsyncSession, store_id: str) -> list[dict[str, Any]]:
        rows = list(
            await db.scalars(
                select(StaffRequest)
                .where(StaffRequest.store_id == store_id)
                .order_by(StaffRequest.created_at.desc())
                .limit(100)
            )
        )
        return await self._wires(db, rows)

    async def store_staff(self, db: AsyncSession, store_id: str) -> list[dict[str, Any]]:
        rows = list(
            await db.scalars(
                select(Staff)
                .where(Staff.store_id == store_id, Staff.role != StaffRole.admin)
                .order_by(Staff.status, Staff.full_name)
            )
        )
        for r in rows:
            await db.refresh(r, ["user"])
        return [staff_wire(r) for r in rows]

    async def resend_temp_password(
        self, db: AsyncSession, store_id: str, staff_id: str, manager_user_id: str
    ) -> dict[str, Any]:
        staff = await db.get(Staff, staff_id)
        if staff is None or staff.store_id != store_id:
            raise ApiError(404, "staff_not_found")
        if not staff.must_change_password or staff.status != StaffStatus.active:
            raise ApiError(409, "password_already_set")
        password = self._set_temp_password(staff)
        self._audit(db, manager_user_id, "staff.temp_password_resent", staff.id)
        await db.commit()
        return {"staff": staff_wire(staff), **self._send(staff, password)}

    # ---- review (admin team) -------------------------------------------------------------------

    async def pending(self, db: AsyncSession, status: str | None) -> list[dict[str, Any]]:
        stmt = select(StaffRequest).order_by(StaffRequest.created_at.desc()).limit(200)
        if status:
            stmt = stmt.where(StaffRequest.status == StaffRequestStatus(status))
        return await self._wires(db, list(await db.scalars(stmt)))

    async def review(
        self, db: AsyncSession, request_id: str, admin_user_id: str, action: str, note: str | None
    ) -> dict[str, Any]:
        req = await db.get(StaffRequest, request_id, with_for_update=True)
        if req is None:
            raise ApiError(404, "staff_request_not_found")
        if req.status != StaffRequestStatus.pending:
            raise ApiError(409, "staff_request_decided")
        if req.requested_by == admin_user_id:
            raise ApiError(403, "cannot_review_own_request")
        note = (note or "").strip() or None
        if action in ("reject", "request_changes") and not note:
            raise ApiError(400, "reason_required")
        if action == "request_changes" and req.type != StaffRequestType.create:
            raise ApiError(400, "invalid_action")

        req.reviewed_by, req.review_note = admin_user_id, note
        result: dict[str, Any] = {}
        if action == "request_changes":
            req.status = StaffRequestStatus.changes_requested
        else:
            req.status = StaffRequestStatus.approved if action == "approve" else StaffRequestStatus.rejected
            req.decided_at = utcnow()
        if req.type == StaffRequestType.create and action == "approve":
            result = await self._create_account(db, req, admin_user_id)
        elif req.type == StaffRequestType.deactivate and req.staff_id:
            staff = await db.get(Staff, req.staff_id)
            if staff:
                approve = action == "approve"
                staff.status = StaffStatus.deactivated if approve else StaffStatus.active
                self._audit(db, admin_user_id, "staff.deactivated" if approve else "staff.restored", staff.id)
        self._audit(
            db, admin_user_id, f"staff_request.{req.status.value}", req.id, {"note": note} if note else None
        )
        await db.commit()
        return {"request": await self._wire(db, req), **result}

    # ---- helpers -------------------------------------------------------------------------------

    async def _create_account(
        self, db: AsyncSession, req: StaffRequest, admin_user_id: str
    ) -> dict[str, Any]:
        await self._assert_phone_free(db, req.phone, ignore_request=req.id)
        code = await self._next_staff_code(db, req.store_id)
        user = User(firebase_uid=f"staff:{code}", name=req.full_name, phone=req.phone)
        db.add(user)
        await db.flush()
        staff = Staff(
            user_id=user.id,
            store_id=req.store_id,
            role=req.role,
            staff_code=code,
            full_name=req.full_name,
            phone=req.phone,
            shift=req.shift,
            employee_ref=req.employee_ref,
        )
        password = self._set_temp_password(staff)
        db.add(staff)
        await db.flush()
        req.staff_id = staff.id
        self._audit(db, admin_user_id, "staff.created", staff.id, {"staffCode": code, "request": req.id})
        staff.user = user
        return {"staff": staff_wire(staff), **self._send(staff, password)}

    def _set_temp_password(self, staff: Staff) -> str:
        password = security.temp_password()
        staff.password_hash = security.hash_password(password)
        staff.must_change_password = True
        staff.temp_password_expires_at = utcnow() + timedelta(hours=security.TEMP_PASSWORD_HOURS)
        staff.failed_logins = 0
        staff.locked_until = None
        return password

    def _send(self, staff: Staff, password: str) -> dict[str, Any]:
        """Texts the staff ID and temporary password to the registered number. With the "log"
        provider (development and demos) the message goes to the log and back to the admin instead."""
        message = (
            f"SmartCart: your store-team login is {staff.staff_code}. Temporary password {password}, "
            f"valid {security.TEMP_PASSWORD_HOURS} hours. You will set your own at first sign-in."
        )
        log.warning("SMS (log provider) to %s: %s", mask_phone(staff.phone), message)
        return {"sms": {"to": mask_phone(staff.phone), "provider": self.sms_provider, "devMessage": message}}

    async def _next_staff_code(self, db: AsyncSession, store_id: str) -> str:
        store = await db.get(Store, store_id)
        prefix = (store.id if store else store_id).replace("-", "")[:4].upper()
        codes = list(await db.scalars(select(Staff.staff_code).where(Staff.staff_code.like(f"{prefix}-%"))))
        n = max((int(c.split("-")[1]) for c in codes if c and c.split("-")[1].isdigit()), default=0) + 1
        return f"{prefix}-{n:04d}"

    async def _assert_phone_free(
        self, db: AsyncSession, phone: str, ignore_request: str | None = None
    ) -> None:
        taken = await db.scalar(
            select(Staff.id).where(Staff.phone == phone, Staff.status != StaffStatus.deactivated)
        )
        pending = await db.scalar(
            select(StaffRequest.id).where(
                StaffRequest.phone == phone,
                StaffRequest.type == StaffRequestType.create,
                StaffRequest.status.in_([StaffRequestStatus.pending, StaffRequestStatus.changes_requested]),
                StaffRequest.id != (ignore_request or ""),
            )
        )
        if taken or pending:
            raise ApiError(409, "phone_already_registered")
        # A deactivated account keeps its row for the audit trail but gives up the number.
        old = await db.scalar(
            select(Staff).where(Staff.phone == phone, Staff.status == StaffStatus.deactivated)
        )
        if old:
            old.phone = None

    async def _wires(self, db: AsyncSession, rows: list[StaffRequest]) -> list[dict[str, Any]]:
        ids = {r.requested_by for r in rows} | {r.reviewed_by for r in rows if r.reviewed_by}
        users = list(await db.scalars(select(User).where(User.id.in_(ids)))) if ids else []
        names = {u.id: u.name for u in users}
        return [request_wire(r, names) for r in rows]

    async def _wire(self, db: AsyncSession, req: StaffRequest) -> dict[str, Any]:
        return (await self._wires(db, [req]))[0]

    def _audit(
        self,
        db: AsyncSession,
        actor: str | None,
        action: str,
        target: str | None,
        details: dict[str, Any] | None = None,
    ) -> None:
        db.add(AuditLog(actor_id=actor, action=action, target=target, details=details))
