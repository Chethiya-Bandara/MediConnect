import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from app.config.supabase import supabase, supabase_admin
from app.middleware.role_checker import build_user_context
from app.schemas.auth_schema import (
    LoginRequest,
    PasswordResetRequest,
    RegisterRequest,
)
from app.utils.helpers import hash_nic, generate_dhid, is_valid_password, get_password_errors, validate_dhid
from supabase_auth.errors import AuthApiError


router = APIRouter()

@router.post("/register")
def register(user: RegisterRequest):

    # ── Password Complexity Validation (Bihanga B-1.1.3) ──────────
    if not is_valid_password(user.password):
        errors = get_password_errors(user.password)
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Password validation failed",
                "errors": errors
            }
        )

    role = user.role
    auth_res = supabase.auth.sign_up({
        "email": user.email,
        "password": user.password
    })

    if not auth_res.user:
        raise HTTPException(status_code=400, detail="Registration failed")

    user_id = auth_res.user.id

    try:
        user_metadata = {
            "full_name": user.fullName,
            "dob": user.dob,
            "gender": user.gender,
            "role": role,
        }
        if role == "patient" and user.parentNic:
            user_metadata["guardian_nic_hash"] = hash_nic(user.parentNic)

        supabase_admin.auth.admin.update_user_by_id(
            user_id,
            {"user_metadata": user_metadata},
        )

        # users table
        supabase_admin.table("users").insert({
            "id": user_id,
            "email": user.email,
            "role": role,
            "name": user.fullName,
        }).execute()

        # ROLE LOGIC
        if role == "patient":
            #generate dhid
            dhid = generate_dhid()
            # validate dhid (just a precaution)
            if not validate_dhid(dhid):
                raise HTTPException(status_code=400, detail="Invalid DHID generated")

            patient_record = {
                "user_id": user_id,
                "dhid": dhid
            }
            if user.nic:
                patient_record["nic"] = hash_nic(user.nic)

            supabase_admin.table("patients").insert(patient_record).execute()

        elif role == "doctor":
            supabase_admin.table("doctors").insert({
                "user_id": user_id,
                "slmc_number": user.licenseNumber,
                "specialization": user.specialization
            }).execute()

        elif role == "pharmacist":
                supabase_admin.table("pharmacists").insert({
                    "user_id": user_id,
                    "pharmacy_id": int(user.pharmacyId),
                    "license_no": user.licenseNumber or f"PENDING-{user_id[:8].upper()}",
                }).execute()

        elif role in ["hospital_admin", "pharmacy_admin", "health_ministry_admin"]:
            organisation_id = (
                int(user.organisationId)
                if user.organisationId and user.organisationId.isdigit()
                else None
            )
            supabase_admin.table("admin_profiles").insert({
                "user_id": user_id,
                "admin_role": role,
                "organisation_id": organisation_id,
            }).execute()

        else:
            raise HTTPException(status_code=400, detail="Invalid role")

    except HTTPException:
        supabase_admin.auth.admin.delete_user(user_id)
        raise
    except Exception:
        supabase_admin.auth.admin.delete_user(user_id)
        raise HTTPException(
            status_code=500,
            detail="Registration could not be completed right now",
        )

    return {"success": True, "message": "Registration successful"}


@router.post("/login")
def login(data: LoginRequest):
    try:
        res = supabase.auth.sign_in_with_password({
            "email": data.email,
            "password": data.password
        })
    except AuthApiError as exc:
        raise HTTPException(status_code=401, detail="Invalid login credentials") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Login failed right now") from exc

    if not res.session:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return {
        "success": True,
        "access_token": res.session.access_token,
        "user": res.user
    }


@router.post("/forgot-password")
def forgot_password(payload: PasswordResetRequest):
    try:
        supabase.auth.reset_password_for_email(payload.email)
    except AuthApiError as exc:
        # Intentional: same response regardless of whether the email exists (account enumeration guard).
        logging.debug("Password reset AuthApiError for %s: %s", payload.email, exc)
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Password reset could not be started right now",
        )

    return {
        "success": True,
        "message": "If an account exists for that email, a reset link has been sent.",
    }


@router.get("/me")
def get_current_user(authorization: Optional[str] = Header(None)):

    if not authorization:
        raise HTTPException(status_code=401, detail="Missing token")

    try:
        token = authorization.split(" ")[1]
        user_res = supabase.auth.get_user(token)

        if not user_res or not user_res.user:
            raise HTTPException(status_code=401, detail="Invalid token")

        user_id = user_res.user.id

        return build_user_context(user_id, token=token)

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Unable to load current user")
