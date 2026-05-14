import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile
from app.config.supabase import anon_key as supabase_anon_key, supabase, supabase_admin, url as supabase_url
from app.middleware.file_validator import validate_upload_file
from app.middleware.role_checker import build_user_context
from app.schemas.auth_schema import (
    LoginRequest,
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    RegisterRequest,
)
from app.utils.helpers import hash_nic, generate_dhid, is_valid_password, get_password_errors, validate_dhid
from app.utils.gemini_client import verify_identity_document
from supabase_auth.errors import AuthApiError


router = APIRouter()
_ADMIN_ROLES = {"hospital_admin", "pharmacy_admin", "health_ministry_admin"}

_STATUS_ALIASES = {
    "approve": "approved",
    "approved": "approved",
    "active": "approved",
    "pending": "pending",
    "reject": "rejected",
    "rejected": "rejected",
    "suspend": "suspended",
    "suspended": "suspended",
}

_BLOCKED_ORGANISATION_STATUSES = {"rejected", "suspended"}
_LOCAL_FRONTEND_FALLBACK = "http://127.0.0.1:5173"

def _normalize_for_match(value: str) -> str:
    return "".join(ch.lower() for ch in value if ch.isalnum())


def _normalize_gender(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in {"m", "male"}:
        return "male"
    if normalized in {"f", "female"}:
        return "female"
    return normalized


def _resolve_frontend_base_url(request: Request | None = None) -> str:
    configured = os.getenv("FRONTEND_URL", "").strip()
    if configured:
        return configured.rstrip("/")

    if request is not None:
        forwarded_origin = request.headers.get("origin", "").strip()
        if forwarded_origin:
            return forwarded_origin.rstrip("/")

        referer = request.headers.get("referer", "").strip()
        if referer:
            try:
                parsed = httpx.URL(referer)
                if parsed.scheme and parsed.host:
                    port = f":{parsed.port}" if parsed.port is not None else ""
                    return f"{parsed.scheme}://{parsed.host}{port}".rstrip("/")
            except Exception:
                pass

    return _LOCAL_FRONTEND_FALLBACK


def _build_password_reset_redirect_url(request: Request | None = None) -> str:
    return f"{_resolve_frontend_base_url(request)}/reset-password"


def _verify_registration_nic_document(
    *,
    file_bytes: bytes,
    file: UploadFile,
    expected_nic: str,
    expected_full_name: str,
    expected_dob: str,
    expected_gender: str,
    require_name_match: bool,
    require_dob_match: bool,
    require_gender_match: bool,
):
    verification, issue = verify_identity_document(
        image_bytes=file_bytes,
        mime_type=file.content_type or "image/jpeg",
        expected_nic=expected_nic,
        expected_full_name=expected_full_name,
        expected_dob=expected_dob,
        expected_gender=expected_gender,
    )
    if verification is None:
        raise HTTPException(
            status_code=503,
            detail=issue or "NIC verification is unavailable right now",
        )

    nic_match = bool(verification.get("matches_expected_nic"))
    name_match = bool(verification.get("matches_expected_name"))
    dob_match = bool(verification.get("matches_expected_dob"))
    gender_match = bool(verification.get("matches_expected_gender"))
    document_ok = bool(verification.get("is_identity_document"))
    extracted_nic = _normalize_for_match(str(verification.get("nic_number") or ""))
    expected_nic_normalized = _normalize_for_match(expected_nic)
    extracted_gender = _normalize_gender(str(verification.get("gender") or ""))
    expected_gender_normalized = _normalize_gender(expected_gender)
    extracted_dob = str(verification.get("date_of_birth") or "").strip()

    if extracted_nic and extracted_nic == expected_nic_normalized:
        nic_match = True
    if expected_dob and extracted_dob and extracted_dob == expected_dob:
        dob_match = True
    if expected_gender_normalized and extracted_gender and extracted_gender == expected_gender_normalized:
        gender_match = True

    if (
        not document_ok
        or not nic_match
        or (require_name_match and not name_match)
        or (require_dob_match and not dob_match)
        or (require_gender_match and not gender_match)
    ):
        reason = str(verification.get("reason") or "").strip()
        raise HTTPException(
            status_code=400,
            detail=(
                reason
                or "NIC image verification failed. Upload a clear NIC image that matches the registration details."
            ),
        )


def _normalize_admin_status(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    return _STATUS_ALIASES.get(normalized, normalized)


def _get_user_row(user_id: str) -> dict | None:
    rows = (
        supabase_admin.table("users")
        .select("id, email, role, status, name, pref_name")
        .eq("id", user_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _get_doctor_row(user_id: str) -> dict | None:
    rows = (
        supabase_admin.table("doctors")
        .select("id, user_id, status")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _parse_organisation_id(raw_value: str | None) -> int | None:
    if raw_value is None or not str(raw_value).strip():
        return None
    if not str(raw_value).strip().isdigit():
        raise HTTPException(status_code=400, detail="Organization ID must be a valid number")
    return int(str(raw_value).strip())


def _require_organisation_by_type(organisation_id: int | None, expected_type: str) -> dict:
    if organisation_id is None:
        raise HTTPException(status_code=400, detail="Organization ID is required for this role")

    organisation_rows = (
        supabase_admin.table("organisations")
        .select("id, name, type, status")
        .eq("id", organisation_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not organisation_rows:
        raise HTTPException(status_code=404, detail="Organization was not found")

    organisation = organisation_rows[0]
    actual_type = str(organisation.get("type") or "").strip().lower()
    if actual_type != expected_type:
        raise HTTPException(
            status_code=400,
            detail=f"This organization ID does not belong to a {expected_type} organisation.",
        )
    organisation_status = _normalize_admin_status(organisation.get("status"))
    if organisation_status in _BLOCKED_ORGANISATION_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"This organization is {organisation_status}. Registration is not allowed for it.",
        )
    return organisation


def _resolve_linked_record_by_organisation(table_name: str, organisation_id: int, not_found_detail: str) -> dict:
    linked_rows = (
        supabase_admin.table(table_name)
        .select("id, organisation_id")
        .eq("organisation_id", organisation_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not linked_rows:
        raise HTTPException(status_code=404, detail=not_found_detail)
    return linked_rows[0]


def _get_blocking_organisation_status(user_id: str, role: str) -> str | None:
    organisation_id = None

    if role == "pharmacist":
        pharmacist_rows = (
            supabase_admin.table("pharmacists")
            .select("pharmacy_id")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        pharmacy_id = pharmacist_rows[0].get("pharmacy_id") if pharmacist_rows else None
        if pharmacy_id is not None:
            pharmacy_rows = (
                supabase_admin.table("pharmacies")
                .select("organisation_id")
                .eq("id", pharmacy_id)
                .limit(1)
                .execute()
                .data
                or []
            )
            organisation_id = pharmacy_rows[0].get("organisation_id") if pharmacy_rows else None
    elif role in _ADMIN_ROLES:
        admin_rows = (
            supabase_admin.table("admin_profiles")
            .select("organisation_id")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        organisation_id = admin_rows[0].get("organisation_id") if admin_rows else None

    if organisation_id is None:
        return None

    organisation_rows = (
        supabase_admin.table("organisations")
        .select("status")
        .eq("id", organisation_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not organisation_rows:
        return None

    organisation_status = _normalize_admin_status(organisation_rows[0].get("status"))
    if organisation_status in _BLOCKED_ORGANISATION_STATUSES:
        return organisation_status
    return None


def _get_login_block_message(user_row: dict) -> str | None:
    user_id = str(user_row.get("id") or "").strip()
    role = str(user_row.get("role") or "").strip().lower()
    status_value = _normalize_admin_status(user_row.get("status"))

    if role == "doctor":
        doctor_row = _get_doctor_row(user_id) if user_id else None
        doctor_status = _normalize_admin_status((doctor_row or {}).get("status"))
        if doctor_status == "approved":
            return None
        if doctor_status == "pending":
            return "Pending approval from the Health Ministry. Your doctor login will work after approval."
        if doctor_status == "suspended":
            return "Your doctor account is suspended. Contact the Health Ministry."
        if doctor_status == "rejected":
            return "Your doctor registration was rejected by the Health Ministry."
        return "Your doctor account is not approved for login yet."

    if role == "pharmacist":
        if status_value == "approved":
            organisation_status = _get_blocking_organisation_status(user_id, role)
            if organisation_status == "suspended":
                return "Your linked organisation is suspended. Login is blocked until it is reactivated."
            if organisation_status == "rejected":
                return "Your linked organisation was rejected. Login is blocked for this account."
            return None
        if status_value == "pending":
            return "Pending approval from your pharmacy admin. Your pharmacist login will work after approval."
        if status_value == "suspended":
            return "Your pharmacist account is suspended. Contact your pharmacy admin."
        if status_value == "rejected":
            return "Your pharmacist account was rejected."
        return "Your pharmacist account is not approved for login yet."

    if role not in _ADMIN_ROLES:
        return None
    if status_value == "approved":
        organisation_status = _get_blocking_organisation_status(user_id, role)
        if organisation_status == "suspended":
            return "Your linked organisation is suspended. Login is blocked until it is reactivated."
        if organisation_status == "rejected":
            return "Your linked organisation was rejected. Login is blocked for this account."
        return None
    if status_value == "pending":
        return "Pending approval from the Health Ministry. Your admin login will work after approval."
    if status_value == "rejected":
        return "Your admin registration was rejected by the Health Ministry."
    if status_value == "suspended":
        return "Your admin account is suspended. Contact the Health Ministry."
    return "Your admin account is not approved for login yet."


@router.post("/register")
async def register(
    email: str = Form(...),
    password: str = Form(...),
    role: str = Form(...),
    fullName: Optional[str] = Form(None),
    preferredName: Optional[str] = Form(None),
    nic: Optional[str] = Form(None),
    dob: Optional[str] = Form(None),
    gender: Optional[str] = Form(None),
    address: Optional[str] = Form(None),
    specialization: Optional[str] = Form(None),
    licenseNumber: Optional[str] = Form(None),
    parentNic: Optional[str] = Form(None),
    organisationId: Optional[str] = Form(None),
    nicImage: UploadFile = File(...),
):
    file_bytes = await validate_upload_file(nicImage)
    if (nicImage.content_type or "").strip().lower() not in {"image/jpeg", "image/png"}:
        raise HTTPException(status_code=400, detail="NIC image must be a JPG or PNG file")

    user = RegisterRequest(
        email=email,
        password=password,
        role=role,
        fullName=fullName,
        preferredName=preferredName,
        nic=nic,
        dob=dob,
        gender=gender,
        address=address,
        specialization=specialization,
        licenseNumber=licenseNumber,
        parentNic=parentNic,
        organisationId=organisationId,
        nicImageFileName=nicImage.filename,
        nicImageFileSize=len(file_bytes),
        nicImageFileType=nicImage.content_type,
    )

    expected_nic = user.nic or user.parentNic
    if not expected_nic:
        raise HTTPException(status_code=400, detail="NIC is required for verification")

    _verify_registration_nic_document(
        file_bytes=file_bytes,
        file=nicImage,
        expected_nic=expected_nic,
        expected_full_name=user.fullName or "",
        expected_dob=user.dob or "",
        expected_gender=user.gender or "",
        require_name_match=bool(user.nic),
        require_dob_match=bool(user.nic),
        require_gender_match=bool(user.nic),
    )

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
            "preferred_name": user.preferredName,
            "dob": user.dob,
            "gender": user.gender,
            "address": user.address,
            "role": role,
            "license_number": user.licenseNumber,
            "nic_verification_status": "verified",
        }
        if role == "patient" and user.parentNic:
            user_metadata["guardian_nic_hash"] = hash_nic(user.parentNic)

        supabase_admin.auth.admin.update_user_by_id(
            user_id,
            {"user_metadata": user_metadata},
        )

        # users table
        user_status = "pending" if role in (_ADMIN_ROLES | {"pharmacist"}) else "active"
        supabase_admin.table("users").insert(
            {
                "id": user_id,
                "email": user.email,
                "role": role,
                "name": user.fullName,
                "pref_name": user.preferredName,
                "address": user.address,
                "nic": user.nic,
                "status": user_status,
            }
        ).execute()

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
            organisation_id = _parse_organisation_id(user.organisationId)
            _require_organisation_by_type(organisation_id, "pharmacy")
            pharmacy = _resolve_linked_record_by_organisation(
                "pharmacies",
                organisation_id,
                "No pharmacy record exists for that organization ID",
            )
            supabase_admin.table("pharmacists").insert({
                "user_id": user_id,
                "pharmacy_id": pharmacy["id"],
                "license_no": user.licenseNumber,
                "status": user_status,
            }).execute()

        elif role in ["hospital_admin", "pharmacy_admin", "health_ministry_admin"]:
            organisation_id = _parse_organisation_id(user.organisationId)
            if role == "hospital_admin":
                _require_organisation_by_type(organisation_id, "hospital")
            elif role == "pharmacy_admin":
                _require_organisation_by_type(organisation_id, "pharmacy")
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

    user_row = _get_user_row(res.user.id)
    if not user_row:
        raise HTTPException(status_code=404, detail="User profile not found")

    login_block_message = _get_login_block_message(user_row)
    if login_block_message:
        raise HTTPException(status_code=403, detail=login_block_message)

    return {
        "success": True,
        "access_token": res.session.access_token,
        "user": res.user
    }


@router.post("/forgot-password")
def forgot_password(payload: PasswordResetRequest, request: Request):
    redirect_to = _build_password_reset_redirect_url(request)

    try:
        supabase.auth.reset_password_for_email(
            payload.email,
            {
                "redirect_to": redirect_to,
            },
        )
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


@router.post("/reset-password")
def confirm_password_reset(payload: PasswordResetConfirmRequest):
    try:
        response = httpx.put(
            f"{supabase_url}/auth/v1/user",
            headers={
                "apikey": supabase_anon_key,
                "Authorization": f"Bearer {payload.accessToken}",
                "Content-Type": "application/json",
            },
            json={
                "password": payload.password,
            },
            timeout=10.0,
        )

        if response.status_code >= 400:
            detail = "Password reset link is invalid or expired."
            try:
                payload_json = response.json()
                message = payload_json.get("msg") or payload_json.get("message") or payload_json.get("error_description")
                if isinstance(message, str) and message.strip():
                    detail = message.strip()
            except Exception:
                pass
            raise HTTPException(status_code=400, detail=detail)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Password could not be reset right now",
        )

    return {
        "success": True,
        "message": "Password reset successful. You can now log in with the new password.",
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
