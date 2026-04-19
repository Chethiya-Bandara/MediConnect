from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from app.config.supabase import supabase_admin
from app.middleware.role_checker import RoleChecker
from app.schemas.hospital_admin_schema import (
    AffiliationDecisionRequest,
    InviteDoctorRequest,
    RevokeAffiliationRequest,
)

router = APIRouter(prefix="/hospital-admin", tags=["hospital-admin-dashboard"])


class CreateAvailabilityRequest(BaseModel):
    doctor_id: str
    slot_date: str
    start_time: str
    end_time: str
    slot_duration_minutes: int = Field(default=15, ge=5, le=240)

    @field_validator("doctor_id", "slot_date", "start_time", "end_time")
    @classmethod
    def validate_text(cls, value: str):
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Field cannot be empty")
        return cleaned


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _hospital_admin_context(current_user: dict = Depends(RoleChecker(["hospital_admin"]))):
    organisation_id = current_user.get("organisation_id")
    if not organisation_id:
        raise HTTPException(
            status_code=400,
            detail="Hospital admin is not linked to an organisation yet",
        )

    hospital_rows = (
        supabase_admin.table("hospitals")
        .select("*")
        .eq("organisation_id", organisation_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not hospital_rows:
        hospital_rows = (
            supabase_admin.table("hospitals")
            .select("*")
            .eq("id", organisation_id)
            .limit(1)
            .execute()
            .data
            or []
        )

    if not hospital_rows:
        raise HTTPException(status_code=404, detail="Hospital profile not found")

    hospital = hospital_rows[0]
    organisation_rows = (
        supabase_admin.table("organisations")
        .select("*")
        .eq("id", hospital["organisation_id"])
        .limit(1)
        .execute()
        .data
        or []
    )
    if not organisation_rows:
        raise HTTPException(status_code=404, detail="Hospital organisation not found")

    return {
        "user": current_user,
        "hospital": hospital,
        "organisation": organisation_rows[0],
    }


def _doctor_details_map(doctor_ids: set[int]):
    if not doctor_ids:
        return {}

    doctors = (
        supabase_admin.table("doctors")
        .select("*")
        .in_("id", list(doctor_ids))
        .execute()
        .data
        or []
    )
    user_ids = [row["user_id"] for row in doctors if row.get("user_id")]
    users = (
        supabase_admin.table("users")
        .select("id, name, email")
        .in_("id", user_ids)
        .execute()
        .data
        or []
    ) if user_ids else []
    user_map = {row["id"]: row for row in users}

    result = {}
    for doctor in doctors:
        linked_user = user_map.get(doctor.get("user_id"), {})
        result[doctor["id"]] = {
            "doctor_id": doctor["id"],
            "doctor_name": linked_user.get("name") or linked_user.get("email") or f"Doctor #{doctor['id']}",
            "doctor_email": linked_user.get("email"),
            "specialization": doctor.get("specialization"),
            "slmc_number": doctor.get("slmc_number"),
        }
    return result


def _recent_audit_logs(current_user_id: str, affiliation_ids: set[int]):
    logs = (
        supabase_admin.table("audit_logs")
        .select("*")
        .order("timestamp", desc=True)
        .limit(50)
        .execute()
        .data
        or []
    )

    relevant = [
        row
        for row in logs
        if row.get("user_id") == current_user_id
        or (
            row.get("entity") == "doctor_affiliations"
            and row.get("entity_id") in affiliation_ids
        )
    ][:20]

    actor_ids = {row["user_id"] for row in relevant if row.get("user_id")}
    actors = (
        supabase_admin.table("users")
        .select("id, name, role, email")
        .in_("id", list(actor_ids))
        .execute()
        .data
        or []
    ) if actor_ids else []
    actor_map = {row["id"]: row for row in actors}

    items = []
    for row in relevant:
        actor = actor_map.get(row.get("user_id"), {})
        items.append(
            {
                "id": row.get("id"),
                "timestamp": row.get("timestamp") or row.get("created_at"),
                "actor_id": row.get("user_id"),
                "actor_name": actor.get("name") or actor.get("email"),
                "actor_role": actor.get("role"),
                "action": row.get("action"),
                "details": f"{row.get('entity', 'record')} #{row.get('entity_id')}",
            }
        )
    return items


@router.get("/dashboard")
def get_hospital_admin_dashboard(context=Depends(_hospital_admin_context)):
    hospital = context["hospital"]
    organisation = context["organisation"]
    current_user = context["user"]

    affiliations = (
        supabase_admin.table("doctor_affiliations")
        .select("*")
        .eq("hospital_id", hospital["id"])
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    doctor_map = _doctor_details_map(
        {row["doctor_id"] for row in affiliations if row.get("doctor_id")}
    )

    pending_affiliations = []
    active_staff = []
    affiliation_ids = set()
    active_doctor_ids = set()
    for row in affiliations:
        affiliation_ids.add(row["id"])
        doctor = doctor_map.get(row.get("doctor_id"), {})
        item = {
            "affiliation_id": row["id"],
            "doctor_id": row.get("doctor_id"),
            "doctor_name": doctor.get("doctor_name"),
            "doctor_email": doctor.get("doctor_email"),
            "specialization": doctor.get("specialization"),
            "slmc_number": doctor.get("slmc_number"),
            "status": row.get("status"),
            "requested_at": row.get("created_at"),
            "joined_at": row.get("created_at"),
        }
        normalized = (row.get("status") or "").lower()
        if normalized == "pending":
            pending_affiliations.append(item)
        if normalized in {"approved", "active"}:
            active_staff.append(item)
            if row.get("doctor_id"):
                active_doctor_ids.add(row["doctor_id"])

    pending_invitations = (
        supabase_admin.table("doctor_invitations")
        .select("*")
        .eq("hospital_id", hospital["id"])
        .eq("status", "PENDING")
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )

    all_appointments = (
        supabase_admin.table("appointments")
        .select("*")
        .eq("organisation_id", organisation["id"])
        .execute()
        .data
        or []
    )
    today = datetime.now().astimezone().date()
    appointments_today = 0
    for row in all_appointments:
        start_time = _parse_iso_datetime(row.get("start_time"))
        if start_time and start_time.astimezone().date() == today:
            appointments_today += 1

    today_slots = []
    if active_doctor_ids:
        slot_rows = (
            supabase_admin.table("availability_slots")
            .select("*")
            .in_("doctor_id", list(active_doctor_ids))
            .execute()
            .data
            or []
        )
        for row in slot_rows:
            start_time = _parse_iso_datetime(row.get("start_time"))
            if start_time and start_time.astimezone().date() == today:
                today_slots.append(row)

    total_slots_today = len(today_slots)
    booked_slots_today = len([row for row in today_slots if row.get("is_booked")])
    capacity_load = round((booked_slots_today / total_slots_today) * 100) if total_slots_today else 0

    return {
        "hospital": {
            "id": hospital["id"],
            "name": organisation.get("name"),
            "type": organisation.get("type"),
            "status": organisation.get("status"),
        },
        "stats": {
            "active_doctors": len(active_doctor_ids),
            "pending_affiliations": len(pending_affiliations),
            "pending_invitations": len(pending_invitations),
            "appointments_today": appointments_today,
            "capacity_load": capacity_load,
            "total_slots_today": total_slots_today,
            "booked_slots_today": booked_slots_today,
        },
        "pending_affiliations": pending_affiliations,
        "pending_invitations": pending_invitations,
        "active_staff": active_staff,
        "audit_logs": _recent_audit_logs(current_user["user_id"], affiliation_ids),
    }


@router.put("/affiliations/decision")
def decide_affiliation(
    data: AffiliationDecisionRequest,
    context=Depends(_hospital_admin_context),
):
    normalized_status = (data.status or "").strip().lower()
    if normalized_status not in {"approved", "rejected"}:
        raise HTTPException(status_code=400, detail="Invalid status value")

    existing = (
        supabase_admin.table("doctor_affiliations")
        .select("*")
        .eq("id", data.affiliation_id)
        .eq("hospital_id", context["hospital"]["id"])
        .limit(1)
        .execute()
        .data
        or []
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Affiliation not found")

    supabase_admin.table("doctor_affiliations").update(
        {"status": normalized_status}
    ).eq("id", data.affiliation_id).execute()

    return {
        "message": f"Affiliation {normalized_status}.",
        "affiliation_id": data.affiliation_id,
        "status": normalized_status,
    }


@router.put("/affiliations/revoke")
def revoke_affiliation(
    data: RevokeAffiliationRequest,
    context=Depends(_hospital_admin_context),
):
    existing = (
        supabase_admin.table("doctor_affiliations")
        .select("*")
        .eq("id", data.affiliation_id)
        .eq("hospital_id", context["hospital"]["id"])
        .limit(1)
        .execute()
        .data
        or []
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Affiliation not found")

    supabase_admin.table("doctor_affiliations").update(
        {"status": "revoked"}
    ).eq("id", data.affiliation_id).execute()

    return {"message": "Affiliation revoked"}


@router.get("/availability/{doctor_id}")
def get_availability(
    doctor_id: str,
    slot_date: Optional[str] = Query(default=None),
    context=Depends(_hospital_admin_context),
):
    doctor_rows = (
        supabase_admin.table("doctor_affiliations")
        .select("*")
        .eq("doctor_id", doctor_id)
        .eq("hospital_id", context["hospital"]["id"])
        .execute()
        .data
        or []
    )
    if not doctor_rows:
        raise HTTPException(status_code=404, detail="Doctor is not linked to this hospital")

    slots = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("doctor_id", doctor_id)
        .order("start_time")
        .execute()
        .data
        or []
    )
    if slot_date:
        slots = [
            row
            for row in slots
            if (start := _parse_iso_datetime(row.get("start_time")))
            and start.astimezone().date().isoformat() == slot_date
        ]

    return slots


@router.post("/availability")
def create_availability(
    data: CreateAvailabilityRequest,
    context=Depends(_hospital_admin_context),
):
    approved_link = (
        supabase_admin.table("doctor_affiliations")
        .select("*")
        .eq("doctor_id", data.doctor_id)
        .eq("hospital_id", context["hospital"]["id"])
        .in_("status", ["approved", "active"])
        .limit(1)
        .execute()
        .data
        or []
    )
    if not approved_link:
        raise HTTPException(
            status_code=400,
            detail="Doctor must be approved for this hospital before slots can be created",
        )

    try:
        start = datetime.fromisoformat(f"{data.slot_date}T{data.start_time}:00")
        end = datetime.fromisoformat(f"{data.slot_date}T{data.end_time}:00")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid slot date or time") from exc

    if end <= start:
        raise HTTPException(status_code=400, detail="End time must be after start time")

    duration = timedelta(minutes=data.slot_duration_minutes)
    cursor = start
    rows = []
    while cursor + duration <= end:
        rows.append(
            {
                "doctor_id": data.doctor_id,
                "start_time": cursor.isoformat(),
                "end_time": (cursor + duration).isoformat(),
            }
        )
        cursor += duration

    if not rows:
        raise HTTPException(status_code=400, detail="No slots could be generated for the selected window")

    created = (
        supabase_admin.table("availability_slots")
        .insert(rows)
        .execute()
        .data
        or []
    )

    return {
        "message": f"Created {len(created)} availability slot(s).",
        "created_count": len(created),
    }


@router.post("/invite")
def invite_doctor(
    data: InviteDoctorRequest,
    context=Depends(_hospital_admin_context),
):
    hospital_id = context["hospital"]["id"]
    if data.hospital_id and str(data.hospital_id) != str(hospital_id):
        raise HTTPException(status_code=403, detail="You can only invite for your own hospital")

    supabase_admin.table("doctor_invitations").insert(
        {
            "doctor_email": data.doctor_email,
            "hospital_id": hospital_id,
            "status": "PENDING",
            "sent_at": datetime.utcnow().isoformat(),
        }
    ).execute()

    return {"message": "Invitation sent"}
