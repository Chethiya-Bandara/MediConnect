# app/routes/admin_router.py
# Health Ministry Admin endpoints for doctor and hospital approvals
# Managed by Bihanga (B-2.2.2)
#
# RBAC Rule:
#   Only health_ministry_admin can approve/reject doctor and hospital registrations
#   Any other role → 403 Forbidden

from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from app.config.supabase import supabase_admin
from app.middleware.role_checker import RoleChecker, HealthMinistryOnly
from app.utils.helpers import validate_dhid, mask_nic

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Request Schemas ───────────────────────────────────────────────────────────

class ApprovalRequest(BaseModel):
    status: str
    notes: Optional[str] = None

    def validate_status(self):
        allowed = {"approved", "rejected", "pending"}
        if self.status.lower() not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status. Must be one of: {allowed}"
            )
        return self.status.lower()


# ── Doctor Approval Endpoints ─────────────────────────────────────────────────

@router.get(
    "/doctors/pending",
    dependencies=[Depends(HealthMinistryOnly)]
)
def get_pending_doctors():
    """
    Returns all doctors pending approval.
    Only accessible by Health Ministry Admins.
    """
    try:
        doctors = (
            supabase_admin.table("doctors")
            .select("*, users(id, email, name)")
            .eq("verification_status", "pending")
            .execute()
            .data or []
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not fetch pending doctors"
        )

    return {
        "count": len(doctors),
        "items": [
            {
                "doctor_id":    doc.get("id"),
                "slmc_number":  doc.get("slmc_number"),
                "specialization": doc.get("specialization"),
                "status":       doc.get("verification_status"),
                "user": {
                    "id":    doc.get("users", {}).get("id"),
                    "name":  doc.get("users", {}).get("name"),
                    "email": doc.get("users", {}).get("email"),
                }
            }
            for doc in doctors
        ]
    }


@router.patch(
    "/doctors/{doctor_id}/approve",
    dependencies=[Depends(HealthMinistryOnly)]
)
def approve_doctor(
    doctor_id: int,
    payload: ApprovalRequest,
    current_user: dict = Depends(HealthMinistryOnly)
):
    """
    Approves or rejects a doctor registration.
    Only accessible by Health Ministry Admins.
    """
    status = payload.validate_status()

    # Check doctor exists
    try:
        doctor = (
            supabase_admin.table("doctors")
            .select("*")
            .eq("id", doctor_id)
            .single()
            .execute()
            .data
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Doctor not found")

    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    # Update verification status
    try:
        supabase_admin.table("doctors").update({
            "verification_status": status,
            "verification_notes":  payload.notes or "",
        }).eq("id", doctor_id).execute()
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not update doctor status"
        )

    # Log the action
    try:
        supabase_admin.table("audit_logs").insert({
            "action":    f"DOCTOR_{status.upper()}",
            "entity":    "doctors",
            "entity_id": doctor_id,
            "user_id":   current_user["user_id"],
            "timestamp": __import__("datetime").datetime.now().astimezone().isoformat(),
        }).execute()
    except Exception:
        pass  # Don't fail if audit log fails

    return {
        "success":   True,
        "doctor_id": doctor_id,
        "status":    status,
        "message":   f"Doctor registration {status} successfully",
    }


# ── Hospital Approval Endpoints ───────────────────────────────────────────────

@router.get(
    "/hospitals/pending",
    dependencies=[Depends(HealthMinistryOnly)]
)
def get_pending_hospitals():
    """
    Returns all hospitals pending approval.
    Only accessible by Health Ministry Admins.
    """
    try:
        hospitals = (
            supabase_admin.table("organisations")
            .select("*")
            .eq("status", "pending")
            .execute()
            .data or []
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not fetch pending hospitals"
        )

    return {
        "count": len(hospitals),
        "items": hospitals
    }


@router.patch(
    "/hospitals/{hospital_id}/approve",
    dependencies=[Depends(HealthMinistryOnly)]
)
def approve_hospital(
    hospital_id: int,
    payload: ApprovalRequest,
    current_user: dict = Depends(HealthMinistryOnly)
):
    """
    Approves or rejects a hospital registration.
    Only accessible by Health Ministry Admins.
    """
    status = payload.validate_status()

    # Check hospital exists
    try:
        hospital = (
            supabase_admin.table("organisations")
            .select("*")
            .eq("id", hospital_id)
            .single()
            .execute()
            .data
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Hospital not found")

    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")

    # Update status
    try:
        supabase_admin.table("organisations").update({
            "status": status,
        }).eq("id", hospital_id).execute()
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not update hospital status"
        )

    # Log the action
    try:
        supabase_admin.table("audit_logs").insert({
            "action":    f"HOSPITAL_{status.upper()}",
            "entity":    "organisations",
            "entity_id": hospital_id,
            "user_id":   current_user["user_id"],
            "timestamp": __import__("datetime").datetime.now().astimezone().isoformat(),
        }).execute()
    except Exception:
        pass

    return {
        "success":     True,
        "hospital_id": hospital_id,
        "status":      status,
        "message":     f"Hospital registration {status} successfully",
    }


# ── DHID Validation Endpoint ──────────────────────────────────────────────────

@router.get(
    "/validate-dhid/{dhid}",
    dependencies=[Depends(HealthMinistryOnly)]
)
def validate_dhid_endpoint(dhid: str):
    """
    Validates a DHID format and checksum.
    Only accessible by Health Ministry Admins.
    """
    from app.utils.helpers import validate_dhid as _validate_dhid
    is_valid = _validate_dhid(dhid)

    return {
        "dhid":     dhid,
        "valid":    is_valid,
        "message":  "Valid DHID" if is_valid else "Invalid DHID format or checksum"
    }
