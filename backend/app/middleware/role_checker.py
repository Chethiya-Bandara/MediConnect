# app/middleware/role_checker.py
# Reusable RBAC guard for FastAPI endpoints
# Managed by Bihanga (B-1.3.1)
#
# USAGE EXAMPLE:
#   from app.middleware.role_checker import RoleChecker
#   from fastapi import Depends
#
#   # Only doctors can access this endpoint
#   @router.get("/encounters", dependencies=[Depends(RoleChecker(["doctor"]))])
#   def get_encounters():
#       ...
#
#   # Access user info inside endpoint
#   @router.get("/profile")
#   def get_profile(current_user: dict = Depends(RoleChecker(["patient"]))):
#       return {"user_id": current_user["user_id"]}

from fastapi import Depends, HTTPException, status, Header
from typing import Optional
from app.config.supabase import supabase, supabase_admin


# ── Core Token Verifier ───────────────────────────────────────────────────────

def get_current_user(
    authorization: Optional[str] = Header(None)
) -> dict:
    """
    Extracts and verifies the Supabase JWT token from the Authorization header.
    Returns user info dict if valid.
    Raises 401 if token is missing, expired, or invalid.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization token. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Extract token from "Bearer <token>"
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header format. Use: Bearer <token>",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = parts[1]

    # Verify token with Supabase
    try:
        auth_user = supabase.auth.get_user(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not auth_user or not auth_user.user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = auth_user.user.id

    # Get user role from database
    try:
        db_user = (
            supabase_admin.table("users")
            .select("id, email, role, name")
            .eq("id", user_id)
            .single()
            .execute()
            .data
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found.",
        )

    if not db_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found.",
        )

    return {
        "token":   token,
        "user_id": user_id,
        "email":   db_user.get("email"),
        "name":    db_user.get("name"),
        "role":    db_user.get("role", "").lower(),
    }


# ── RoleChecker Class ─────────────────────────────────────────────────────────

class RoleChecker:
    """
    Reusable FastAPI dependency that restricts endpoint access by role.

    MediConnect roles:
        patient
        doctor
        pharmacist
        hospital_admin
        pharmacy_admin
        health_ministry_admin

    Usage:
        # As a dependency (blocks wrong roles, endpoint gets user info)
        @router.get("/endpoint")
        def my_endpoint(current_user: dict = Depends(RoleChecker(["doctor"]))):
            return {"user_id": current_user["user_id"]}

        # As a route-level guard (simpler, no user info needed)
        @router.get("/endpoint", dependencies=[Depends(RoleChecker(["doctor"]))])
        def my_endpoint():
            ...
    """

    def __init__(self, allowed_roles: list[str]):
        self.allowed_roles = [role.lower() for role in allowed_roles]

    def __call__(
        self,
        current_user: dict = Depends(get_current_user)
    ) -> dict:
        user_role = current_user.get("role", "")

        if user_role not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Access denied. "
                    f"Required: {' or '.join(self.allowed_roles)}. "
                    f"Your role: {user_role}."
                )
            )

        return current_user


# ── Pre-built Role Guards ─────────────────────────────────────────────────────
# Ready-to-use instances — import and use directly

PatientOnly        = RoleChecker(["patient"])
DoctorOnly         = RoleChecker(["doctor"])
PharmacistOnly     = RoleChecker(["pharmacist"])
HospitalAdminOnly  = RoleChecker(["hospital_admin"])
PharmacyAdminOnly  = RoleChecker(["pharmacy_admin"])
HealthMinistryOnly = RoleChecker(["health_ministry_admin"])

# Combined guards
DoctorOrAdmin  = RoleChecker(["doctor", "hospital_admin"])
AnyAdmin       = RoleChecker(["hospital_admin", "pharmacy_admin", "health_ministry_admin"])
MedicalStaff   = RoleChecker(["doctor", "pharmacist"])
