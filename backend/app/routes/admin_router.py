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


def _coerce_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _audit_entity_organisation_map(audit_rows: list[dict]) -> dict[tuple[str, int], int]:
    entity_ids_by_type: dict[str, set[int]] = {}
    for row in audit_rows:
        entity = str(row.get("entity") or "").strip().lower()
        entity_id = _coerce_int(row.get("entity_id"))
        if not entity or entity_id is None:
            continue
        entity_ids_by_type.setdefault(entity, set()).add(entity_id)

    resolved: dict[tuple[str, int], int] = {}

    organisation_ids = entity_ids_by_type.get("organisations", set())
    for organisation_id in organisation_ids:
        resolved[("organisations", organisation_id)] = organisation_id

    hospital_ids = entity_ids_by_type.get("hospitals", set())
    if hospital_ids:
        hospital_rows = (
            supabase_admin.table("hospitals")
            .select("id, organisation_id")
            .in_("id", list(hospital_ids))
            .execute()
            .data
            or []
        )
        for row in hospital_rows:
            hospital_id = _coerce_int(row.get("id"))
            organisation_id = _coerce_int(row.get("organisation_id"))
            if hospital_id is not None and organisation_id is not None:
                resolved[("hospitals", hospital_id)] = organisation_id

    pharmacy_ids = entity_ids_by_type.get("pharmacies", set())
    if pharmacy_ids:
        pharmacy_rows = (
            supabase_admin.table("pharmacies")
            .select("id, organisation_id")
            .in_("id", list(pharmacy_ids))
            .execute()
            .data
            or []
        )
        for row in pharmacy_rows:
            pharmacy_id = _coerce_int(row.get("id"))
            organisation_id = _coerce_int(row.get("organisation_id"))
            if pharmacy_id is not None and organisation_id is not None:
                resolved[("pharmacies", pharmacy_id)] = organisation_id

    appointment_ids = entity_ids_by_type.get("appointments", set())
    if appointment_ids:
        appointment_rows = (
            supabase_admin.table("appointments")
            .select("id, organisation_id")
            .in_("id", list(appointment_ids))
            .execute()
            .data
            or []
        )
        for row in appointment_rows:
            appointment_id = _coerce_int(row.get("id"))
            organisation_id = _coerce_int(row.get("organisation_id"))
            if appointment_id is not None and organisation_id is not None:
                resolved[("appointments", appointment_id)] = organisation_id

    encounter_ids = entity_ids_by_type.get("encounters", set())
    encounter_to_appointment: dict[int, int] = {}
    if encounter_ids:
        encounter_rows = (
            supabase_admin.table("encounters")
            .select("id, appointment_id")
            .in_("id", list(encounter_ids))
            .execute()
            .data
            or []
        )
        encounter_to_appointment = {
            encounter_id: appointment_id
            for row in encounter_rows
            if (encounter_id := _coerce_int(row.get("id"))) is not None
            and (appointment_id := _coerce_int(row.get("appointment_id"))) is not None
        }
        missing_appointments = {
            appointment_id
            for appointment_id in encounter_to_appointment.values()
            if ("appointments", appointment_id) not in resolved
        }
        if missing_appointments:
            appointment_rows = (
                supabase_admin.table("appointments")
                .select("id, organisation_id")
                .in_("id", list(missing_appointments))
                .execute()
                .data
                or []
            )
            for row in appointment_rows:
                appointment_id = _coerce_int(row.get("id"))
                organisation_id = _coerce_int(row.get("organisation_id"))
                if appointment_id is not None and organisation_id is not None:
                    resolved[("appointments", appointment_id)] = organisation_id
        for encounter_id, appointment_id in encounter_to_appointment.items():
            organisation_id = resolved.get(("appointments", appointment_id))
            if organisation_id is not None:
                resolved[("encounters", encounter_id)] = organisation_id

    doctor_ids = entity_ids_by_type.get("doctors", set())
    if doctor_ids:
        doctor_rows = (
            supabase_admin.table("doctor_affiliations")
            .select("doctor_id, hospital_id, status, created_at")
            .in_("doctor_id", list(doctor_ids))
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        )
        approved_rows = [
            row for row in doctor_rows if str(row.get("status") or "").strip().lower() in {"approved", "active"}
        ]
        hospital_ids = {
            hospital_id
            for row in approved_rows
            if (hospital_id := _coerce_int(row.get("hospital_id"))) is not None
        }
        hospital_rows = (
            supabase_admin.table("hospitals")
            .select("id, organisation_id")
            .in_("id", list(hospital_ids))
            .execute()
            .data
            or []
        ) if hospital_ids else []
        hospital_to_org = {
            _coerce_int(row.get("id")): _coerce_int(row.get("organisation_id"))
            for row in hospital_rows
        }
        for row in approved_rows:
            doctor_id = _coerce_int(row.get("doctor_id"))
            hospital_id = _coerce_int(row.get("hospital_id"))
            organisation_id = hospital_to_org.get(hospital_id)
            if doctor_id is None or organisation_id is None or ("doctors", doctor_id) in resolved:
                continue
            resolved[("doctors", doctor_id)] = organisation_id

    doctor_affiliation_ids = entity_ids_by_type.get("doctor_affiliations", set())
    if doctor_affiliation_ids:
        affiliation_rows = (
            supabase_admin.table("doctor_affiliations")
            .select("id, hospital_id")
            .in_("id", list(doctor_affiliation_ids))
            .execute()
            .data
            or []
        )
        hospital_ids = {
            hospital_id
            for row in affiliation_rows
            if (hospital_id := _coerce_int(row.get("hospital_id"))) is not None
        }
        hospital_rows = (
            supabase_admin.table("hospitals")
            .select("id, organisation_id")
            .in_("id", list(hospital_ids))
            .execute()
            .data
            or []
        ) if hospital_ids else []
        hospital_to_org = {
            _coerce_int(row.get("id")): _coerce_int(row.get("organisation_id"))
            for row in hospital_rows
        }
        for row in affiliation_rows:
            affiliation_id = _coerce_int(row.get("id"))
            hospital_id = _coerce_int(row.get("hospital_id"))
            organisation_id = hospital_to_org.get(hospital_id)
            if affiliation_id is not None and organisation_id is not None:
                resolved[("doctor_affiliations", affiliation_id)] = organisation_id

    pharmacist_ids = entity_ids_by_type.get("pharmacists", set())
    if pharmacist_ids:
        pharmacist_rows = (
            supabase_admin.table("pharmacists")
            .select("id, pharmacy_id")
            .in_("id", list(pharmacist_ids))
            .execute()
            .data
            or []
        )
        pharmacy_ids = {
            pharmacy_id
            for row in pharmacist_rows
            if (pharmacy_id := _coerce_int(row.get("pharmacy_id"))) is not None
        }
        pharmacy_rows = (
            supabase_admin.table("pharmacies")
            .select("id, organisation_id")
            .in_("id", list(pharmacy_ids))
            .execute()
            .data
            or []
        ) if pharmacy_ids else []
        pharmacy_to_org = {
            _coerce_int(row.get("id")): _coerce_int(row.get("organisation_id"))
            for row in pharmacy_rows
        }
        for row in pharmacist_rows:
            pharmacist_id = _coerce_int(row.get("id"))
            pharmacy_id = _coerce_int(row.get("pharmacy_id"))
            organisation_id = pharmacy_to_org.get(pharmacy_id)
            if pharmacist_id is not None and organisation_id is not None:
                resolved[("pharmacists", pharmacist_id)] = organisation_id

    admin_profile_ids = entity_ids_by_type.get("admin_profiles", set())
    if admin_profile_ids:
        admin_profile_rows = (
            supabase_admin.table("admin_profiles")
            .select("id, organisation_id")
            .in_("id", list(admin_profile_ids))
            .execute()
            .data
            or []
        )
        for row in admin_profile_rows:
            profile_id = _coerce_int(row.get("id"))
            organisation_id = _coerce_int(row.get("organisation_id"))
            if profile_id is not None and organisation_id is not None:
                resolved[("admin_profiles", profile_id)] = organisation_id

    prescription_ids = entity_ids_by_type.get("prescriptions", set())
    prescription_to_encounter: dict[int, int] = {}
    if prescription_ids:
        prescription_rows = (
            supabase_admin.table("prescriptions")
            .select("id, encounter_id")
            .in_("id", list(prescription_ids))
            .execute()
            .data
            or []
        )
        prescription_to_encounter = {
            prescription_id: encounter_id
            for row in prescription_rows
            if (prescription_id := _coerce_int(row.get("id"))) is not None
            and (encounter_id := _coerce_int(row.get("encounter_id"))) is not None
        }

    prescription_item_ids = entity_ids_by_type.get("prescription_items", set())
    if prescription_item_ids:
        prescription_item_rows = (
            supabase_admin.table("prescription_items")
            .select("id, prescription_id")
            .in_("id", list(prescription_item_ids))
            .execute()
            .data
            or []
        )
        missing_prescriptions: set[int] = set()
        for row in prescription_item_rows:
            item_id = _coerce_int(row.get("id"))
            prescription_id = _coerce_int(row.get("prescription_id"))
            if item_id is None or prescription_id is None:
                continue
            if prescription_id not in prescription_to_encounter:
                missing_prescriptions.add(prescription_id)
            resolved[("prescription_items", item_id)] = prescription_id
        if missing_prescriptions:
            prescription_rows = (
                supabase_admin.table("prescriptions")
                .select("id, encounter_id")
                .in_("id", list(missing_prescriptions))
                .execute()
                .data
                or []
            )
            for row in prescription_rows:
                prescription_id = _coerce_int(row.get("id"))
                encounter_id = _coerce_int(row.get("encounter_id"))
                if prescription_id is not None and encounter_id is not None:
                    prescription_to_encounter[prescription_id] = encounter_id

    for prescription_id, encounter_id in prescription_to_encounter.items():
        organisation_id = resolved.get(("encounters", encounter_id))
        if organisation_id is not None:
            resolved[("prescriptions", prescription_id)] = organisation_id

    for key, value in list(resolved.items()):
        if key[0] == "prescription_items" and isinstance(value, int):
            organisation_id = resolved.get(("prescriptions", value))
            if organisation_id is not None:
                resolved[key] = organisation_id
            else:
                resolved.pop(key, None)

    dispensing_ids = entity_ids_by_type.get("dispensing", set())
    if dispensing_ids:
        dispensing_rows = (
            supabase_admin.table("dispensing")
            .select("id, pharmacy_id, prescription_id")
            .in_("id", list(dispensing_ids))
            .execute()
            .data
            or []
        )
        missing_pharmacies = {
            pharmacy_id
            for row in dispensing_rows
            if (pharmacy_id := _coerce_int(row.get("pharmacy_id"))) is not None
            and ("pharmacies", pharmacy_id) not in resolved
        }
        if missing_pharmacies:
            pharmacy_rows = (
                supabase_admin.table("pharmacies")
                .select("id, organisation_id")
                .in_("id", list(missing_pharmacies))
                .execute()
                .data
                or []
            )
            for row in pharmacy_rows:
                pharmacy_id = _coerce_int(row.get("id"))
                organisation_id = _coerce_int(row.get("organisation_id"))
                if pharmacy_id is not None and organisation_id is not None:
                    resolved[("pharmacies", pharmacy_id)] = organisation_id
        for row in dispensing_rows:
            dispensing_id = _coerce_int(row.get("id"))
            pharmacy_id = _coerce_int(row.get("pharmacy_id"))
            prescription_id = _coerce_int(row.get("prescription_id"))
            organisation_id = resolved.get(("pharmacies", pharmacy_id)) if pharmacy_id is not None else None
            if organisation_id is None and prescription_id is not None:
                organisation_id = resolved.get(("prescriptions", prescription_id))
            if dispensing_id is not None and organisation_id is not None:
                resolved[("dispensing", dispensing_id)] = organisation_id

    return resolved


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

    actor_user_ids: list[str] | None = None
    if user_id:
        actor_lookup_rows = (
            supabase_admin.table("users")
            .select("id")
            .eq("nic", user_id.strip())
            .execute()
            .data
            or []
        )
        actor_user_ids = [str(row.get("id")) for row in actor_lookup_rows if row.get("id")]

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

        if actor_user_ids:
            query = query.in_("user_id", actor_user_ids)
        elif user_id:
            query = query.eq("user_id", user_id)

        if from_date:
            query = query.gte("timestamp", from_date)

        if to_date:
            query = query.lte("timestamp", to_date)

        if org_id_int is not None:
            raw_fetch_limit = min(max(limit * 20, 200), 1000)
            logs = query.range(0, raw_fetch_limit - 1).execute().data or []
        else:
            logs = query.range(offset, offset + limit - 1).execute().data or []

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not fetch audit logs"
        )

    user_ids = [str(row.get("user_id")) for row in logs if row.get("user_id")]
    entity_org_map = _audit_entity_organisation_map(logs)
    org_ids = []
    for row in logs:
        direct_org_id = _coerce_int(row.get("organisation_id"))
        entity = str(row.get("entity") or "").strip().lower()
        entity_id = _coerce_int(row.get("entity_id"))
        derived_org_id = entity_org_map.get((entity, entity_id)) if entity_id is not None else None
        resolved_org_id = direct_org_id if direct_org_id is not None else derived_org_id
        if resolved_org_id is not None:
            org_ids.append(resolved_org_id)

    user_lookup = {}
    if user_ids:
        user_rows = (
            supabase_admin.table("users")
            .select("id, nic, role, name, pref_name")
            .in_("id", list(dict.fromkeys(user_ids)))
            .execute()
            .data
            or []
        )
        user_lookup = {str(row.get("id")): row for row in user_rows if row.get("id")}

    organisation_lookup = {}
    if org_ids:
        organisation_rows = (
            supabase_admin.table("organisations")
            .select("id, name")
            .in_("id", list(dict.fromkeys(org_ids)))
            .execute()
            .data
            or []
        )
        organisation_lookup = {int(row.get("id")): row for row in organisation_rows if row.get("id") is not None}

    enriched_logs = []
    for row in logs:
        actor = user_lookup.get(str(row.get("user_id")))
        direct_org_id = _coerce_int(row.get("organisation_id"))
        entity = str(row.get("entity") or "").strip().lower()
        entity_id = _coerce_int(row.get("entity_id"))
        derived_org_id = entity_org_map.get((entity, entity_id)) if entity_id is not None else None
        resolved_org_id = direct_org_id if direct_org_id is not None else derived_org_id
        organisation = organisation_lookup.get(resolved_org_id) if resolved_org_id is not None else None
        enriched_logs.append(
            {
                **row,
                "actor_name": (actor.get("pref_name") or actor.get("name")) if actor else None,
                "actor_role": actor.get("role") if actor else None,
                "actor_nic": mask_nic(actor.get("nic", "")) if actor and actor.get("nic") else None,
                "organisation_id": resolved_org_id,
                "organisation_name": organisation.get("name") if organisation else None,
            }
        )

    total_count = len(enriched_logs)
    if org_id_int is not None:
        filtered_logs = [
            row for row in enriched_logs if _coerce_int(row.get("organisation_id")) == org_id_int
        ]
        total_count = len(filtered_logs)
        enriched_logs = filtered_logs[offset: offset + limit]

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
        "count":   total_count,
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
        "logs": enriched_logs,
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
