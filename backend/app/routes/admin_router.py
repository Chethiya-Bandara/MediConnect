# app/routes/admin_router.py
# Health Ministry Admin endpoints for doctor and hospital approvals
# Managed by Bihanga (B-2.2.2)
#
# RBAC Rule:
#   Only health_ministry_admin can approve/reject doctor and hospital registrations
#   Any other role → 403 Forbidden

from datetime import datetime, timezone
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
            "timestamp": datetime.now(timezone.utc).isoformat(),
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
            "timestamp": datetime.now(timezone.utc).isoformat(),
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

# ── NIC Privacy Verification (B-2.3.1) ───────────────────────────────────────

@router.get(
    "/patients/{patient_id}/nic",
    dependencies=[Depends(HealthMinistryOnly)]
)
def get_masked_nic(patient_id: int):
    """
    Returns a masked NIC for a patient.
    NEVER returns the raw NIC or the hash.
    Only shows masked format e.g. XXXXX6789V

    Only accessible by Health Ministry Admins.
    Verifies NIC masking is applied to Doctor Verification dashboard.
    """
    try:
        patient = (
            supabase_admin.table("patients")
            .select("id, dhid, nic")
            .eq("id", patient_id)
            .single()
            .execute()
            .data
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Patient not found")

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    # ── NIC Masking Applied (Bihanga B-2.3.1) ────────────────────
    # The stored NIC is a hash — we mask it for display
    # Raw NIC is never returned under any circumstances
    stored_nic = patient.get("nic", "")
    masked     = mask_nic(stored_nic) if stored_nic else "NOT SET"

    return {
        "patient_id": patient_id,
        "dhid":       patient.get("dhid"),
        "nic":        masked,          # ← always masked, never raw
        "note":       "NIC is masked for privacy. Raw NIC is never returned by the API."
    }

@router.get(
    "/doctor-verification/{doctor_id}/patient-nics",
    dependencies=[Depends(HealthMinistryOnly)]
)
def get_doctor_patients_masked_nics(doctor_id: int):
    """
    Returns masked NICs for all patients seen by a doctor.
    Used in Doctor Verification dashboard.
    NICs are always masked — raw values never returned.

    Only accessible by Health Ministry Admins.
    """
    try:
        # Get all appointments for this doctor
        appointments = (
            supabase_admin.table("appointments")
            .select("patient_id")
            .eq("doctor_id", doctor_id)
            .execute()
            .data or []
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not fetch doctor appointments"
        )

    patient_ids = list({apt["patient_id"] for apt in appointments})

    if not patient_ids:
        return {"doctor_id": doctor_id, "patients": []}

    try:
        patients = (
            supabase_admin.table("patients")
            .select("id, dhid, nic")
            .in_("id", patient_ids)
            .execute()
            .data or []
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not fetch patient data"
        )

    return {
        "doctor_id": doctor_id,
        "patients": [
            {
                "patient_id": p.get("id"),
                "dhid":       p.get("dhid"),
                "nic":        mask_nic(p.get("nic", "")) if p.get("nic") else "NOT SET",
            }
            for p in patients
        ],
        "note": "All NICs are masked. Raw values are never returned."
    }

# ── Audit Log Export Security (Bihanga B-6.2.2) ───────────────────────────────
# Audit logs are highly sensitive — restricted to Health Ministry Admins only.
# All access to audit logs is itself logged for accountability.

from datetime import datetime as _dt
from typing import Optional as _Optional
from fastapi import Query as _Query


@router.get(
    "/audit-logs",
    dependencies=[Depends(HealthMinistryOnly)]
)
def get_audit_logs(
    current_user:    dict = Depends(HealthMinistryOnly),
    action:          str  = _Query(default=None, description="Filter by action e.g. CONSENT_GRANTED"),
    entity:          str  = _Query(default=None, description="Filter by entity e.g. appointments"),
    user_id:         str  = _Query(default=None, description="Filter by user ID"),
    organisation_id: str  = _Query(default=None, description="Filter by organisation ID (NFR-7.5)"),
    from_date:       str  = _Query(default=None, description="Start date ISO format e.g. 2026-01-01"),
    to_date:         str  = _Query(default=None, description="End date ISO format e.g. 2026-12-31"),
    limit:           int  = _Query(default=50, le=200, description="Max results (200 max)"),
    offset:          int  = _Query(default=0, description="Pagination offset"),
):
    """
    Returns paginated audit logs.
    Health Ministry Admins only — any other role gets 403.
    Access to this endpoint is itself logged for accountability.
    """

    # ── Validate organisation_id before query ─────────────────────
    org_id_int: int | None = None
    if organisation_id:
        try:
            org_id_int = int(organisation_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="organisation_id must be an integer")

    # ── Build query with filters ──────────────────────────────────
    try:
        query = (
            supabase_admin.table("audit_logs")
            .select("*")
            .order("timestamp", desc=True)
        )

        if action:
            query = query.eq("action", action.upper())

        if entity:
            query = query.eq("entity", entity.lower())

        if user_id:
            query = query.eq("user_id", user_id)

        if org_id_int is not None:
            query = query.eq("organisation_id", org_id_int)

        if from_date:
            query = query.gte("timestamp", from_date)

        if to_date:
            query = query.lte("timestamp", to_date)

        logs = query.range(offset, offset + limit - 1).execute().data or []

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not fetch audit logs"
        )

    # ── Log this access (audit the auditors) ─────────────────────
    try:
        supabase_admin.table("audit_logs").insert({
            "action":    "AUDIT_LOG_ACCESSED",
            "entity":    "audit_logs",
            "entity_id": 0,
            "user_id":   current_user["user_id"],
            "timestamp": _dt.now().astimezone().isoformat(),
        }).execute()
    except Exception:
        pass

    return {
        "count":   len(logs),
        "offset":  offset,
        "limit":   limit,
        "filters": {
            "action":          action,
            "entity":          entity,
            "user_id":         user_id,
            "organisation_id": organisation_id,
            "from_date":       from_date,
            "to_date":         to_date,
        },
        "logs": logs,
    }


@router.get(
    "/audit-logs/export",
    dependencies=[Depends(HealthMinistryOnly)]
)
def export_audit_logs(
    current_user: dict = Depends(HealthMinistryOnly),
    from_date:    str  = _Query(..., description="Start date ISO format e.g. 2026-01-01"),
    to_date:      str  = _Query(..., description="End date ISO format e.g. 2026-12-31"),
    entity:       str  = _Query(default=None, description="Filter by entity type"),
):
    """
    Exports audit logs for a date range.
    Health Ministry Admins only.
    Maximum 30-day range per export to prevent bulk data extraction.
    """
    # ── Validate date range ───────────────────────────────────────
    try:
        start = _dt.fromisoformat(from_date)
        end   = _dt.fromisoformat(to_date)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid date format. Use ISO format e.g. 2026-01-01"
        )

    # ── Enforce 30-day maximum range ──────────────────────────────
    delta_days = (end - start).days
    if delta_days < 0:
        raise HTTPException(
            status_code=400,
            detail="to_date must be after from_date"
        )

    if delta_days > 30:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Export range cannot exceed 30 days. "
                f"Requested range: {delta_days} days. "
                f"Please split into smaller exports."
            )
        )

    # ── Fetch logs ────────────────────────────────────────────────
    try:
        query = (
            supabase_admin.table("audit_logs")
            .select("*")
            .gte("timestamp", from_date)
            .lte("timestamp", to_date)
            .order("timestamp", desc=True)
            .limit(10000)
        )

        if entity:
            query = query.eq("entity", entity.lower())

        logs = query.execute().data or []

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not export audit logs"
        )

    # ── Log this export ───────────────────────────────────────────
    try:
        supabase_admin.table("audit_logs").insert({
            "action":    "AUDIT_LOG_EXPORTED",
            "entity":    "audit_logs",
            "entity_id": 0,
            "user_id":   current_user["user_id"],
            "timestamp": _dt.now().astimezone().isoformat(),
            "notes":     f"Export range: {from_date} to {to_date}, {len(logs)} records"
        }).execute()
    except Exception:
        pass

    return {
        "export_range": {
            "from": from_date,
            "to":   to_date,
            "days": delta_days,
        },
        "total_records": len(logs),
        "exported_by":   current_user["user_id"],
        "exported_at":   _dt.now().astimezone().isoformat(),
        "logs":          logs,
    }
