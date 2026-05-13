from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from app.config.supabase import supabase_admin
from app.middleware.role_checker import RoleChecker, build_user_context
from app.schemas.hospital_admin_schema import (
    AffiliationDecisionRequest,
    InviteDoctorRequest,
    RevokeAffiliationRequest,
)

router = APIRouter(prefix="/hospital-admin", tags=["hospital-admin-dashboard"])


class CreateAvailabilityRequest(BaseModel):
    doctor_id: int
    slot_date: str
    start_time: str
    end_time: str
    slot_duration_minutes: int = Field(default=15, ge=5, le=240)

    @field_validator("slot_date", "start_time", "end_time")
    @classmethod
    def validate_text(cls, value: str):
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Field cannot be empty")
        return cleaned

    @field_validator("doctor_id")
    @classmethod
    def validate_doctor_id(cls, value: int):
        if value <= 0:
            raise ValueError("doctor_id must be positive")
        return value

class UpdateAvailabilityRequest(BaseModel):
    start_time: str
    end_time: str

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_text(cls, value: str):
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Field cannot be empty")
        return cleaned


class UpdateHospitalAdminProfileRequest(BaseModel):
    preferred_name: str = Field(min_length=2, max_length=120)
    address: str = Field(min_length=5, max_length=255)

    @field_validator("preferred_name", "address")
    @classmethod
    def validate_text(cls, value: str):
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Field cannot be empty")
        return cleaned


SRI_LANKA_TZ = timezone(timedelta(hours=5, minutes=30))


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=SRI_LANKA_TZ)
        return parsed
    except ValueError:
        return None


def _parse_local_slot_datetime(slot_date: str, slot_time: str) -> datetime:
    parsed = datetime.fromisoformat(f"{slot_date}T{slot_time}:00")
    return parsed.replace(tzinfo=SRI_LANKA_TZ)


def _local_date(value: Optional[str]) -> Optional[str]:
    parsed = _parse_iso_datetime(value)
    if not parsed:
        return None
    return parsed.astimezone(SRI_LANKA_TZ).date().isoformat()


def _active_slot_appointment(slot: dict, organisation_id: int) -> Optional[dict]:
    doctor_id = slot.get("doctor_id")
    start_time = slot.get("start_time")
    end_time = slot.get("end_time")
    if not doctor_id or not start_time or not end_time:
        return None

    rows = (
        supabase_admin.table("appointments")
        .select("*")
        .eq("doctor_id", doctor_id)
        .eq("organisation_id", organisation_id)
        .not_.in_("status", ["cancelled", "completed"])
        .lt("start_time", end_time)
        .gt("end_time", start_time)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _insert_availability_rows(rows: list[dict]):
    return (
        supabase_admin.table("availability_slots")
        .insert(rows)
        .execute()
        .data
        or []
    )


def _log_audit_action(user_id: str, action: str, entity: str, entity_id: int | str):
    now = datetime.now(SRI_LANKA_TZ).isoformat()
    supabase_admin.table("audit_logs").insert(
        {
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "timestamp": now,
            "user_id": user_id,
        }
    ).execute()


def _approved_hospital_affiliation(doctor_id: int | str, hospital_id: int | str) -> Optional[dict]:
    rows = (
        supabase_admin.table("doctor_affiliations")
        .select("*")
        .eq("doctor_id", doctor_id)
        .eq("hospital_id", hospital_id)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    return next(
        (
            row
            for row in rows
            if (row.get("status") or "").lower() in {"approved", "active"}
        ),
        None,
    )


def _parse_doctor_id(value: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid doctor ID") from exc


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
        .select("id, name, pref_name, email")
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
            "doctor_name": linked_user.get("pref_name") or linked_user.get("name") or linked_user.get("email") or f"Doctor #{doctor['id']}",
            "doctor_email": linked_user.get("email"),
            "specialization": doctor.get("specialization"),
            "slmc_number": doctor.get("slmc_number"),
        }
    return result


def _recent_audit_logs(current_user_id: str):
    logs = (
        supabase_admin.table("audit_logs")
        .select("*")
        .order("timestamp", desc=True)
        .limit(100)
        .execute()
        .data
        or []
    )

    relevant = [
        row
        for row in logs
        if row.get("user_id") == current_user_id
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
    revoked_staff = []
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
        if normalized == "revoked":
            revoked_staff.append(item)

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
    today = datetime.now(SRI_LANKA_TZ).date()
    appointments_today = 0
    for row in all_appointments:
        start_time = _parse_iso_datetime(row.get("start_time"))
        if start_time and start_time.astimezone(SRI_LANKA_TZ).date() == today:
            appointments_today += 1

    today_slots = []
    if active_doctor_ids:
        slot_rows = (
            supabase_admin.table("availability_slots")
            .select("*")
            .in_("doctor_id", list(active_doctor_ids))
            .eq("hospital_id", hospital["id"])
            .execute()
            .data
            or []
        )
        for row in slot_rows:
            start_time = _parse_iso_datetime(row.get("start_time"))
            if start_time and start_time.astimezone(SRI_LANKA_TZ).date() == today:
                today_slots.append(row)

    total_slots_today = len(today_slots)
    booked_slots_today = len([row for row in today_slots if row.get("is_booked")])
    capacity_load = round((booked_slots_today / total_slots_today) * 100) if total_slots_today else 0

    return {
        "hospital": {
            "id": organisation["id"],
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
        "revoked_staff": revoked_staff,
        "audit_logs": _recent_audit_logs(current_user["user_id"]),
    }


@router.patch("/profile")
def update_hospital_admin_profile(
    data: UpdateHospitalAdminProfileRequest,
    context=Depends(_hospital_admin_context),
):
    current_user = context["user"]
    updated_rows = (
        supabase_admin.table("users")
        .update(
            {
                "pref_name": data.preferred_name.strip(),
                "address": data.address.strip(),
            }
        )
        .eq("id", current_user["user_id"])
        .execute()
        .data
        or []
    )
    if not updated_rows:
        raise HTTPException(status_code=404, detail="User profile not found.")

    _log_audit_action(
        current_user["user_id"],
        "HOSPITAL_ADMIN_PROFILE_UPDATED",
        "users",
        current_user["user_id"],
    )

    return {
        "message": "Settings saved.",
        "user": build_user_context(current_user["user_id"], token=current_user.get("token")),
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
    _log_audit_action(
        context["user"]["user_id"],
        f"AFFILIATION_{normalized_status.upper()}",
        "doctor_affiliations",
        data.affiliation_id,
    )

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
    _log_audit_action(
        context["user"]["user_id"],
        "AFFILIATION_REVOKED",
        "doctor_affiliations",
        data.affiliation_id,
    )

    return {"message": "Affiliation revoked"}


@router.get("/availability/{doctor_id}")
def get_availability(
    doctor_id: int,
    slot_date: Optional[str] = Query(default=None),
    context=Depends(_hospital_admin_context),
):
    if not _approved_hospital_affiliation(doctor_id, context["hospital"]["id"]):
        raise HTTPException(status_code=404, detail="Doctor is not linked to this hospital")

    slots = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("doctor_id", doctor_id)
        .eq("hospital_id", context["hospital"]["id"])
        .order("start_time")
        .execute()
        .data
        or []
    )
    if slot_date:
        slots = [
            row
            for row in slots
            if _local_date(row.get("start_time")) == slot_date
        ]

    return {"slots": slots}


@router.post("/availability")
def create_availability(
    data: CreateAvailabilityRequest,
    context=Depends(_hospital_admin_context),
):
    doctor_id = _parse_doctor_id(data.doctor_id)
    approved_link = _approved_hospital_affiliation(doctor_id, context["hospital"]["id"])
    if not approved_link:
        raise HTTPException(
            status_code=400,
            detail="Doctor must be approved for this hospital before slots can be created",
        )

    try:
        start = _parse_local_slot_datetime(data.slot_date, data.start_time)
        end = _parse_local_slot_datetime(data.slot_date, data.end_time)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid slot date or time") from exc

    if end <= start:
        raise HTTPException(status_code=400, detail="End time must be after start time")

    duration = timedelta(minutes=data.slot_duration_minutes)
    existing_slots = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("doctor_id", doctor_id)
        .lt("start_time", end.isoformat())
        .gt("end_time", start.isoformat())
        .execute()
        .data
        or []
    )
    if existing_slots:
        raise HTTPException(status_code=409, detail="Selected window overlaps existing availability")

    cursor = start
    rows = []
    while cursor + duration <= end:
        row = {
            "doctor_id": doctor_id,
            "hospital_id": context["hospital"]["id"],
            "start_time": cursor.isoformat(),
            "end_time": (cursor + duration).isoformat(),
        }
        rows.append(row)
        cursor += duration

    if not rows:
        raise HTTPException(status_code=400, detail="No slots could be generated for the selected window")

    created = _insert_availability_rows(rows)
    if created:
        _log_audit_action(
            context["user"]["user_id"],
            "AVAILABILITY_CREATED",
            "availability_slots",
            created[0].get("id") or doctor_id,
        )

    return {
        "message": f"Created {len(created)} availability slot(s).",
        "created_count": len(created),
        "slots": created,
    }


@router.patch("/availability/{slot_id}")
def update_availability(
    slot_id: int,
    data: UpdateAvailabilityRequest,
    context=Depends(_hospital_admin_context),
):
    current_rows = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("id", slot_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not current_rows:
        raise HTTPException(status_code=404, detail="Availability slot not found")

    current = current_rows[0]
    doctor_id = current.get("doctor_id")
    if current.get("hospital_id") and str(current.get("hospital_id")) != str(context["hospital"]["id"]):
        raise HTTPException(status_code=403, detail="Slot does not belong to this hospital")

    if not _approved_hospital_affiliation(doctor_id, context["hospital"]["id"]):
        raise HTTPException(status_code=403, detail="Slot does not belong to this hospital scope")
    if current.get("is_booked"):
        raise HTTPException(status_code=400, detail="Booked slots cannot be edited")

    start = _parse_iso_datetime(data.start_time)
    end = _parse_iso_datetime(data.end_time)
    if not start or not end:
        raise HTTPException(status_code=400, detail="Invalid slot date or time")
    if end <= start:
        raise HTTPException(status_code=400, detail="End time must be after start time")

    overlaps = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("doctor_id", doctor_id)
        .neq("id", slot_id)
        .lt("start_time", end.isoformat())
        .gt("end_time", start.isoformat())
        .execute()
        .data
        or []
    )
    if overlaps:
        raise HTTPException(status_code=409, detail="Updated slot overlaps existing availability")

    updated = (
        supabase_admin.table("availability_slots")
        .update({"start_time": start.isoformat(), "end_time": end.isoformat()})
        .eq("id", slot_id)
        .execute()
        .data
        or []
    )
    _log_audit_action(
        context["user"]["user_id"],
        "AVAILABILITY_UPDATED",
        "availability_slots",
        slot_id,
    )
    return {"success": True, "slot": updated[0] if updated else None}


@router.delete("/availability/{slot_id}")
def delete_availability(
    slot_id: int,
    context=Depends(_hospital_admin_context),
):
    current_rows = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("id", slot_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not current_rows:
        raise HTTPException(status_code=404, detail="Availability slot not found")

    current = current_rows[0]
    if current.get("hospital_id") and str(current.get("hospital_id")) != str(context["hospital"]["id"]):
        raise HTTPException(status_code=403, detail="Slot does not belong to this hospital")

    if not _approved_hospital_affiliation(current.get("doctor_id"), context["hospital"]["id"]):
        raise HTTPException(status_code=403, detail="Slot does not belong to this hospital scope")
    if current.get("is_booked"):
        raise HTTPException(status_code=400, detail="Booked slots cannot be deleted")

    supabase_admin.table("availability_slots").delete().eq("id", slot_id).execute()
    _log_audit_action(
        context["user"]["user_id"],
        "AVAILABILITY_DELETED",
        "availability_slots",
        slot_id,
    )
    return {"success": True}


@router.post("/availability/{slot_id}/cancel-booking")
def cancel_booked_appointment_for_slot(
    slot_id: int,
    context=Depends(_hospital_admin_context),
):
    current_rows = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("id", slot_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not current_rows:
        raise HTTPException(status_code=404, detail="Availability slot not found")

    current = current_rows[0]
    if current.get("hospital_id") and str(current.get("hospital_id")) != str(context["hospital"]["id"]):
        raise HTTPException(status_code=403, detail="Slot does not belong to this hospital")

    if not _approved_hospital_affiliation(current.get("doctor_id"), context["hospital"]["id"]):
        raise HTTPException(status_code=403, detail="Slot does not belong to this hospital scope")
    if not current.get("is_booked"):
        raise HTTPException(status_code=400, detail="This slot is already open")

    appointment = _active_slot_appointment(current, context["organisation"]["id"])
    if not appointment:
        supabase_admin.table("availability_slots").update({"is_booked": False}).eq("id", slot_id).execute()
        _log_audit_action(
            context["user"]["user_id"],
            "AVAILABILITY_REOPENED",
            "availability_slots",
            slot_id,
        )
        return {
            "success": True,
            "message": "Slot was marked booked without an active appointment. It has been reopened.",
            "appointment_id": None,
        }

    supabase_admin.table("appointments").update({"status": "cancelled"}).eq("id", appointment["id"]).execute()
    supabase_admin.table("availability_slots").update({"is_booked": False}).eq("id", slot_id).execute()
    _log_audit_action(
        context["user"]["user_id"],
        "BOOKING_CANCELLED",
        "appointments",
        appointment["id"],
    )

    return {
        "success": True,
        "message": "Booked appointment cancelled and slot reopened.",
        "appointment_id": appointment["id"],
    }


@router.post("/invite")
def invite_doctor(
    data: InviteDoctorRequest,
    context=Depends(_hospital_admin_context),
):
    hospital_id = context["hospital"]["id"]
    normalized_email = str(data.doctor_email).strip().lower()
    if data.hospital_id:
        provided_value = str(data.hospital_id).strip()
        allowed_values = {
            str(hospital_id),
            str(context["organisation"]["id"]),
        }
        if provided_value not in allowed_values:
            raise HTTPException(status_code=403, detail="You can only invite for your own hospital")

    existing_pending = (
        supabase_admin.table("doctor_invitations")
        .select("id")
        .eq("doctor_email", normalized_email)
        .eq("hospital_id", hospital_id)
        .eq("status", "PENDING")
        .limit(1)
        .execute()
        .data
        or []
    )
    if existing_pending:
        raise HTTPException(status_code=409, detail="A pending invitation already exists for this doctor.")

    created = (
        supabase_admin.table("doctor_invitations").insert(
        {
            "doctor_email": normalized_email,
            "hospital_id": hospital_id,
            "status": "PENDING",
            "sent_at": datetime.utcnow().isoformat(),
        }
    ).execute().data
        or []
    )
    _log_audit_action(
        context["user"]["user_id"],
        "DOCTOR_INVITED",
        "doctor_invitations",
        created[0].get("id") if created else hospital_id,
    )

    return {"message": "Invitation sent"}
