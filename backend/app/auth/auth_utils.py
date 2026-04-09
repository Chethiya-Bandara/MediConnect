# backend/auth/auth_utils.py

from datetime import datetime, timedelta, timezone
from typing import Optional
import jwt
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError

from app.config.security_config import (
    JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET,
    JWT_ALGORITHM,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_EXPIRE_DAYS,
)


# ─── Access Token ─────────────────────────────────────────────────────────────

def create_access_token(subject: str, role: str) -> str:
    """
    Creates a short-lived access token (15 minutes).
    Subject is typically the user's ID.
    Role is used by the RoleChecker guard on protected endpoints.
    """
    now    = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    payload = {
        "sub":  subject,    # user ID
        "role": role,       # "patient" | "doctor" | "pharmacist" | "hospital_admin" | "health_ministry_admin"
        "type": "access",
        "iat":  now,
        "exp":  expire,
    }
    return jwt.encode(payload, JWT_ACCESS_SECRET, algorithm=JWT_ALGORITHM)


# ─── Refresh Token ────────────────────────────────────────────────────────────

def create_refresh_token(subject: str) -> str:
    """
    Creates a long-lived refresh token (7 days).
    Does NOT contain role — role is re-fetched from DB when access token is renewed.
    """
    now    = datetime.now(timezone.utc)
    expire = now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    payload = {
        "sub":  subject,
        "type": "refresh",
        "iat":  now,
        "exp":  expire,
    }
    return jwt.encode(payload, JWT_REFRESH_SECRET, algorithm=JWT_ALGORITHM)


# ─── Token Verification ───────────────────────────────────────────────────────

def verify_access_token(token: str) -> Optional[dict]:
    """
    Verifies and decodes an access token.
    Returns the payload dict on success, None on failure.
    """
    try:
        payload = jwt.decode(token, JWT_ACCESS_SECRET, algorithms=[JWT_ALGORITHM])

        # Guard: reject if someone passes a refresh token here
        if payload.get("type") != "access":
            return None

        return payload

    except ExpiredSignatureError:
        return None  # Token expired — frontend should use refresh token
    except InvalidTokenError:
        return None  # Tampered or malformed token


def verify_refresh_token(token: str) -> Optional[dict]:
    """
    Verifies and decodes a refresh token.
    Returns the payload dict on success, None on failure.
    """
    try:
        payload = jwt.decode(token, JWT_REFRESH_SECRET, algorithms=[JWT_ALGORITHM])

        # Guard: reject if someone passes an access token here
        if payload.get("type") != "refresh":
            return None

        return payload

    except ExpiredSignatureError:
        return None  # Refresh token expired — user must log in again
    except InvalidTokenError:
        return None  # Tampered or malformed token
