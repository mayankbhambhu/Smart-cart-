"""Store-team passwords and the session tokens the API issues after a password sign-in.

Shoppers sign in with Firebase (Google, phone OTP, Apple). The store team signs in with a staff ID
or registered phone number and a password the API checks itself; it then issues its own signed
token, which every route accepts alongside Firebase ID tokens.
"""

import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

ISSUER = "smartcart"
SESSION_HOURS = 12  # shared handhelds: a sign-in lasts at most one long shift
TEMP_PASSWORD_HOURS = 72
MAX_FAILED_LOGINS = 5
LOCK_MINUTES = 15
MIN_PASSWORD_LENGTH = 8
# No 0/O, 1/l/I: temporary passwords are read off an SMS and typed on a handheld.
_TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    if not password_hash:
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def temp_password() -> str:
    return "".join(secrets.choice(_TEMP_ALPHABET) for _ in range(10))


def password_problem(password: str) -> str | None:
    """Why a new password is refused, or None. Long enough, and not only digits."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return "password_too_short"
    if password.isdigit():
        return "password_only_digits"
    return None


def normalise_phone(raw: str) -> str | None:
    """An Indian mobile number as +91XXXXXXXXXX, or None if it is not one."""
    digits = re.sub(r"[\s()-]", "", raw or "")
    if digits.startswith("+91"):
        digits = digits[3:]
    elif digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    return f"+91{digits}" if re.fullmatch(r"[6-9]\d{9}", digits) else None


@dataclass(frozen=True)
class SessionClaims:
    uid: str
    name: str | None


def issue_session(secret: str, uid: str, name: str | None, staff_id: str) -> tuple[str, datetime]:
    expires = datetime.now(UTC) + timedelta(hours=SESSION_HOURS)
    token = jwt.encode(
        {"iss": ISSUER, "sub": uid, "name": name, "sid": staff_id, "exp": expires},
        secret,
        algorithm="HS256",
    )
    return token, expires


def is_session_token(token: str) -> bool:
    try:
        return jwt.get_unverified_header(token).get("alg") == "HS256"
    except jwt.PyJWTError:
        return False


def read_session(secret: str, token: str) -> SessionClaims:
    claims = jwt.decode(
        token, secret, algorithms=["HS256"], issuer=ISSUER, options={"require": ["exp", "sub"]}
    )
    return SessionClaims(uid=claims["sub"], name=claims.get("name"))
