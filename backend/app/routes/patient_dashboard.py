import json
import os
from datetime import datetime
from typing import Literal, Optional
from urllib import error as urllib_error
from urllib import request as urllib_request

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator

from app.config.supabase import supabase, supabase_admin
from app.middleware.role_checker import RoleChecker
from app.utils.helpers import validate_dhid, mask_nic, sanitize_search_query

router = APIRouter(prefix="/patient/dashboard", tags=["patient-dashboard"])


class AppointmentCreateRequest(BaseModel):
    slot_id: int


class AppointmentUpdateRequest(BaseModel):
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    status: Optional[str] = None

    @field_validator("status")
    @classmethod
    def normalize_status(cls, value: Optional[str]):
        if value is None:
            return value

        normalized = value.strip().lower()
        allowed = {"pending", "confirmed", "cancelled", "completed"}
        if normalized not in allowed:
            raise ValueError("Invalid appointment status")
        return normalized

    @model_validator(mode="after")
    def validate_payload(self):
        if self.start_time is None and self.end_time is None and self.status is None:
            raise ValueError("Provide at least one field to update")

        if self.start_time and self.end_time and self.end_time <= self.start_time:
            raise ValueError("End time must be later than start time")

        return self


class ConsentUpdateRequest(BaseModel):
    granted: bool


class ProfileUpdateRequest(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str):
        cleaned = value.strip()
        if len(cleaned) < 3:
            raise ValueError("Name must be at least 3 characters")
        return cleaned


class AssistantHistoryMessage(BaseModel):
    role: Literal["assistant", "user"]
    text: str

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str):
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Message text cannot be empty")
        if len(cleaned) > 4000:
            raise ValueError("Message text is too long")
        return cleaned


class AssistantRequest(BaseModel):
    message: str
    history: list[AssistantHistoryMessage] = Field(default_factory=list)

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str):
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Message cannot be empty")
        if len(cleaned) > 4000:
            raise ValueError("Message is too long")
        return cleaned


def _bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing token")

    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    return parts[1]


def _require_patient_context(authorization: Optional[str]):
    token = _bearer_token(authorization)

    try:
        auth_user = supabase.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    if not auth_user or not auth_user.user:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = auth_user.user.id

    try:
        db_user = (
            supabase_admin.table("users")
            .select("*")
            .eq("id", user_id)
            .single()
            .execute()
            .data
        )
    except Exception as exc:
        raise HTTPException(status_code=404, detail="User profile not found") from exc

    if not db_user or db_user.get("role") != "patient":
        raise HTTPException(status_code=403, detail="Patient access required")

    try:
        patient = (
            supabase_admin.table("patients")
            .select("*")
            .eq("user_id", user_id)
            .single()
            .execute()
            .data
        )
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Patient profile not found") from exc

    return {
        "token": token,
        "user_id": user_id,
        "user": db_user,
        "patient": patient,
    }


def _title_status(value: Optional[str]) -> str:
    return (value or "unknown").replace("_", " ").title()


def _user_map(user_ids: set[str]):
    if not user_ids:
        return {}

    rows = (
        supabase_admin.table("users")
        .select("*")
        .in_("id", list(user_ids))
        .execute()
        .data
        or []
    )
    return {row["id"]: row for row in rows}


def _doctor_map(doctor_ids: set[int]):
    if not doctor_ids:
        return {}

    rows = (
        supabase_admin.table("doctors")
        .select("*")
        .in_("id", list(doctor_ids))
        .execute()
        .data
        or []
    )
    user_lookup = _user_map({row["user_id"] for row in rows if row.get("user_id")})

    result = {}
    for row in rows:
        linked_user = user_lookup.get(row.get("user_id"), {})
        display_name = (
            linked_user.get("name")
            or linked_user.get("email")
            or f"Doctor #{row['id']}"
        )
        result[row["id"]] = {
            **row,
            "display_name": display_name,
            "email": linked_user.get("email"),
        }
    return result


def _organisation_map(organisation_ids: set[int]):
    if not organisation_ids:
        return {}

    rows = (
        supabase_admin.table("organisations")
        .select("*")
        .in_("id", list(organisation_ids))
        .execute()
        .data
        or []
    )
    return {row["id"]: row for row in rows}


def _format_appointment(row, doctor_lookup, organisation_lookup):
    return _format_appointment_with_consent(row, doctor_lookup, organisation_lookup, {})


def _format_appointment_with_consent(row, doctor_lookup, organisation_lookup, consent_lookup):
    doctor = doctor_lookup.get(row["doctor_id"], {})
    organisation = organisation_lookup.get(row["organisation_id"], {})
    consent = consent_lookup.get(row["id"], {})
    appointment_status = _title_status(row.get("status"))
    consent_granted = bool(consent.get("granted")) and appointment_status.lower() != "completed"
    return {
        "id": row["id"],
        "status": appointment_status,
        "start_time": row.get("start_time"),
        "end_time": row.get("end_time"),
        "doctor": {
            "id": row["doctor_id"],
            "name": doctor.get("display_name", f"Doctor #{row['doctor_id']}"),
            "specialization": doctor.get("specialization"),
            "email": doctor.get("email"),
        },
        "organisation": {
            "id": row["organisation_id"],
            "name": organisation.get("name", f"Organisation #{row['organisation_id']}"),
            "type": organisation.get("type"),
            "status": organisation.get("status"),
        },
        "consent": {
            "granted": consent_granted,
            "last_updated": consent.get("last_updated"),
            "status": (
                "Completed"
                if appointment_status.lower() == "completed"
                else "Granted"
                if consent_granted
                else "Revoked"
                if consent.get("last_updated")
                else "Pending"
            ),
        },
    }


def _format_record(row, appointments_map, doctor_lookup, prescriptions_map, items_map, organisation_lookup):
    appointment = appointments_map.get(row.get("appointment_id"))
    doctor = doctor_lookup.get(row["doctor_id"], {})
    organisation = organisation_lookup.get(appointment.get("organisation_id")) if appointment else {}
    linked_prescriptions = prescriptions_map.get(row["id"], [])

    return {
        "id": row["id"],
        "created_at": row.get("created_at"),
        "notes": row.get("notes"),
        "doctor": {
            "id": row["doctor_id"],
            "name": doctor.get("display_name", f"Doctor #{row['doctor_id']}"),
            "specialization": doctor.get("specialization"),
        },
        "appointment": {
            "id": appointment.get("id") if appointment else None,
            "start_time": appointment.get("start_time") if appointment else None,
            "end_time": appointment.get("end_time") if appointment else None,
            "status": _title_status(appointment.get("status")) if appointment else None,
        },
        "organisation": {
            "id": organisation.get("id"),
            "name": organisation.get("name"),
        },
        "prescriptions": [
            {
                "id": prescription["id"],
                "status": _title_status(prescription.get("status")),
                "created_at": prescription.get("created_at"),
                "items": items_map.get(prescription["id"], []),
            }
            for prescription in linked_prescriptions
        ],
    }


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _assistant_datetime_label(value: Optional[str]) -> str:
    parsed = _parse_iso_datetime(value)
    if not parsed:
        return "an unscheduled time"
    return parsed.astimezone().strftime("%b %d, %Y at %I:%M %p")


def _log_audit_action(user_id: str, action: str, entity: str, entity_id: int):
    now = datetime.now().astimezone().isoformat()
    supabase_admin.table("audit_logs").insert(
        {
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "timestamp": now,
            "user_id": user_id,
        }
    ).execute()


def _consent_state_map(appointment_ids: set[int]):
    if not appointment_ids:
        return {}

    rows = (
        supabase_admin.table("audit_logs")
        .select("*")
        .eq("entity", "appointment_consent")
        .in_("entity_id", list(appointment_ids))
        .order("timestamp", desc=True)
        .execute()
        .data
        or []
    )

    consent_lookup = {}
    for row in rows:
        appointment_id = row["entity_id"]
        if appointment_id in consent_lookup:
            continue
        consent_lookup[appointment_id] = {
            "granted": row.get("action") == "CONSENT_GRANTED",
            "last_updated": row.get("timestamp") or row.get("created_at"),
        }

    return consent_lookup


def _build_assistant_snapshot(patient: dict, user: dict):
    appointments = (
        supabase_admin.table("appointments")
        .select("*")
        .eq("patient_id", patient["id"])
        .order("start_time")
        .limit(25)
        .execute()
        .data
        or []
    )
    encounters = (
        supabase_admin.table("encounters")
        .select("*")
        .eq("patient_id", patient["id"])
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data
        or []
    )
    prescriptions = (
        supabase_admin.table("prescriptions")
        .select("*")
        .eq("patient_id", patient["id"])
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data
        or []
    )

    doctor_ids = {row["doctor_id"] for row in appointments if row.get("doctor_id")}
    doctor_ids.update({row["doctor_id"] for row in encounters if row.get("doctor_id")})
    doctor_lookup = _doctor_map(doctor_ids)

    organisation_ids = {
        row["organisation_id"] for row in appointments if row.get("organisation_id")
    }
    organisation_lookup = _organisation_map(organisation_ids)

    prescription_ids = [row["id"] for row in prescriptions]
    prescription_items = (
        supabase_admin.table("prescription_items")
        .select("*")
        .in_("prescription_id", prescription_ids)
        .execute()
        .data
        or []
    ) if prescription_ids else []
    items_by_prescription = {}
    for row in prescription_items:
        items_by_prescription.setdefault(row["prescription_id"], []).append(row)

    now = datetime.now().astimezone()
    next_appointment = next(
        (
            row
            for row in appointments
            if row.get("status") != "cancelled"
            and _parse_iso_datetime(row.get("start_time"))
            and _parse_iso_datetime(row.get("start_time")) >= now
        ),
        None,
    )
    latest_record = encounters[0] if encounters else None
    latest_prescription = prescriptions[0] if prescriptions else None

    latest_medicines = [
        {
            "medicine_name": item.get("medicine_name"),
            "dosage": item.get("dosage"),
            "quantity": item.get("quantity"),
            "instructions": item.get("instructions"),
        }
        for item in items_by_prescription.get(latest_prescription["id"], [])
    ] if latest_prescription else []

    next_doctor = doctor_lookup.get(next_appointment["doctor_id"], {}) if next_appointment else {}
    next_org = (
        organisation_lookup.get(next_appointment["organisation_id"], {})
        if next_appointment
        else {}
    )
    latest_doctor = doctor_lookup.get(latest_record["doctor_id"], {}) if latest_record else {}

    return {
        "user": {
            "id": user["id"],
            "name": user.get("name"),
            "email": user.get("email"),
        },
        "patient": {
            "id": patient["id"],
            "dhid": patient.get("dhid"),
            "created_at": patient.get("created_at"),
        },
        "stats": {
            "appointments": len(appointments),
            "encounters": len(encounters),
            "prescriptions": len(prescriptions),
        },
        "next_appointment": {
            "doctor_name": next_doctor.get("display_name"),
            "doctor_specialization": next_doctor.get("specialization"),
            "organisation_name": next_org.get("name"),
            "start_time": next_appointment.get("start_time"),
            "end_time": next_appointment.get("end_time"),
            "status": _title_status(next_appointment.get("status")),
        } if next_appointment else None,
        "latest_record": {
            "doctor_name": latest_doctor.get("display_name"),
            "doctor_specialization": latest_doctor.get("specialization"),
            "created_at": latest_record.get("created_at"),
            "notes": latest_record.get("notes"),
        } if latest_record else None,
        "latest_prescription": {
            "id": latest_prescription.get("id"),
            "status": _title_status(latest_prescription.get("status")),
            "created_at": latest_prescription.get("created_at"),
            "items": latest_medicines,
        } if latest_prescription else None,
    }


def _extract_edge_answer(payload) -> Optional[str]:
    if isinstance(payload, str):
        cleaned = payload.strip()
        return cleaned or None

    if isinstance(payload, list):
        for item in payload:
            answer = _extract_edge_answer(item)
            if answer:
                return answer
        return None

    if not isinstance(payload, dict):
        return None

    for key in ("answer", "response", "reply", "text", "message"):
        answer = payload.get(key)
        if isinstance(answer, str) and answer.strip():
            return answer.strip()

    content = payload.get("content")
    if isinstance(content, dict):
        for key in ("answer", "response", "text"):
            answer = content.get(key)
            if isinstance(answer, str) and answer.strip():
                return answer.strip()

    candidates = payload.get("candidates")
    if isinstance(candidates, list):
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            candidate_content = candidate.get("content", {})
            parts = candidate_content.get("parts", []) if isinstance(candidate_content, dict) else []
            for part in parts:
                if isinstance(part, dict):
                    text = part.get("text")
                    if isinstance(text, str) and text.strip():
                        return text.strip()

    return None


def _call_gemini_edge(message: str, history: list[AssistantHistoryMessage], snapshot: dict):
    edge_url = os.getenv("GEMINI_EDGE_FUNCTION_URL")
    if not edge_url:
        return None

    token = os.getenv("GEMINI_EDGE_FUNCTION_TOKEN") or os.getenv("SUPABASE_SERVICE_KEY")
    payload = {
        "message": message,
        "history": [{"role": item.role, "text": item.text} for item in history[-12:]],
        "patient_context": snapshot,
    }
    encoded = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["apikey"] = token

    request = urllib_request.Request(edge_url, data=encoded, headers=headers, method="POST")

    try:
        with urllib_request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except urllib_error.HTTPError as exc:
        return None
    except urllib_error.URLError:
        return None

    if not raw.strip():
        return None

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return raw.strip()

    return _extract_edge_answer(parsed)


def _fallback_assistant_answer(message: str, snapshot: dict) -> str:
    normalized = message.lower()
    latest_record = snapshot.get("latest_record")
    next_appointment = snapshot.get("next_appointment")
    latest_prescription = snapshot.get("latest_prescription")
    patient = snapshot.get("patient", {})

    if any(token in normalized for token in ("diagnosis", "record", "last visit", "notes")):
        if not latest_record:
            return "I could not find a saved encounter record yet. Once a doctor logs one, I can explain it here."

        notes = latest_record.get("notes")
        if notes:
            doctor_name = latest_record.get("doctor_name") or "your doctor"
            return f"Your latest saved record from {doctor_name} says: {notes}"
        return "Your latest encounter exists, but it does not include consultation notes yet."

    if any(token in normalized for token in ("appointment", "next", "schedule")):
        if not next_appointment:
            return "You do not have an upcoming appointment saved right now."

        doctor_name = next_appointment.get("doctor_name") or "your doctor"
        organisation_name = next_appointment.get("organisation_name") or "the selected organisation"
        start_time = _assistant_datetime_label(next_appointment.get("start_time"))
        status = next_appointment.get("status") or "Unknown"
        return (
            f"Your next appointment is with {doctor_name} at {organisation_name} on "
            f"{start_time}. Current status: {status}."
        )

    if any(token in normalized for token in ("medicine", "medicines", "prescription", "drug")):
        items = latest_prescription.get("items", []) if latest_prescription else []
        if not items:
            return "I could not find prescription medicines on your latest saved record yet."

        medicines = ", ".join(
            f"{item.get('medicine_name')} ({item.get('dosage')}, qty {item.get('quantity')})"
            for item in items
            if item.get("medicine_name")
        )
        return f"Your latest prescription lists: {medicines}."

    if any(token in normalized for token in ("dhid", "digital id", "digital health", "id")):
        dhid = patient.get("dhid")
        if not dhid:
            return "I could not find your Digital Health ID yet."
        return f"Your Digital Health ID is {dhid}. Open the Digital ID card if you want the QR version."

    return (
        "I can help with your latest medical record, prescriptions, next appointment, and Digital Health ID. "
        "Ask me about one of those and I will answer from the saved patient data."
    )


@router.get("/overview", dependencies=[Depends(RoleChecker(["patient"]))])
def get_overview(authorization: Optional[str] = Header(None)):
    context = _require_patient_context(authorization)
    patient = context["patient"]

    appointments = (
        supabase_admin.table("appointments")
        .select("*")
        .eq("patient_id", patient["id"])
        .order("start_time")
        .execute()
        .data
        or []
    )
    encounters = (
        supabase_admin.table("encounters")
        .select("*")
        .eq("patient_id", patient["id"])
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    prescriptions = (
        supabase_admin.table("prescriptions")
        .select("*")
        .eq("patient_id", patient["id"])
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    inventory_rows = (
        supabase_admin.table("inventory")
        .select("*", count="exact")
        .limit(1)
        .execute()
    )

    doctor_lookup = _doctor_map({row["doctor_id"] for row in appointments})
    organisation_lookup = _organisation_map({row["organisation_id"] for row in appointments})
    consent_lookup = _consent_state_map({row["id"] for row in appointments})
    upcoming = next(
        (
            row
            for row in appointments
            if row.get("status") != "cancelled"
            and row.get("start_time")
            and datetime.fromisoformat(row["start_time"].replace("Z", "+00:00"))
            >= datetime.now().astimezone()
        ),
        None,
    )

    recent_encounter = encounters[0] if encounters else None
    recent_appointment_map = {
        row["id"]: row
        for row in (
            supabase_admin.table("appointments")
            .select("*")
            .in_("id", [recent_encounter["appointment_id"]])
            .execute()
            .data
            or []
        )
    } if recent_encounter and recent_encounter.get("appointment_id") else {}

    return {
        "user": {
            "id": context["user"]["id"],
            "email": context["user"]["email"],
            "name": context["user"].get("name"),
        },
        "patient": {
            "id": patient["id"],
            "dhid": patient["dhid"],
            "created_at": patient.get("created_at"),
        },
        "stats": {
            "total_appointments": len(appointments),
            "upcoming_appointments": len(
                [
                    row
                    for row in appointments
                    if row.get("status") != "cancelled"
                    and row.get("start_time")
                    and datetime.fromisoformat(row["start_time"].replace("Z", "+00:00"))
                    >= datetime.now().astimezone()
                ]
            ),
            "medical_records": len(encounters),
            "active_prescriptions": len(
                [row for row in prescriptions if row.get("status") != "cancelled"]
            ),
            "pharmacy_items_indexed": inventory_rows.count or 0,
        },
        "next_appointment": _format_appointment_with_consent(
            upcoming, doctor_lookup, organisation_lookup, consent_lookup
        )
        if upcoming
        else None,
        "recent_record": {
            "id": recent_encounter["id"],
            "created_at": recent_encounter.get("created_at"),
            "notes": recent_encounter.get("notes"),
            "appointment": recent_appointment_map.get(recent_encounter.get("appointment_id")),
        }
        if recent_encounter
        else None,
    }


@router.get("/appointments")
def list_appointments(authorization: Optional[str] = Header(None)):
    context = _require_patient_context(authorization)
    patient = context["patient"]

    rows = (
        supabase_admin.table("appointments")
        .select("*")
        .eq("patient_id", patient["id"])
        .order("start_time")
        .execute()
        .data
        or []
    )
    doctor_lookup = _doctor_map({row["doctor_id"] for row in rows})
    organisation_lookup = _organisation_map({row["organisation_id"] for row in rows})
    consent_lookup = _consent_state_map({row["id"] for row in rows})

    return {
        "items": [
            _format_appointment_with_consent(
                row, doctor_lookup, organisation_lookup, consent_lookup
            )
            for row in rows
        ]
    }


@router.patch("/profile")
def update_profile(
    payload: ProfileUpdateRequest,
    authorization: Optional[str] = Header(None),
):
    context = _require_patient_context(authorization)

    updated = (
        supabase_admin.table("users")
        .update({"name": payload.name})
        .eq("id", context["user_id"])
        .execute()
        .data
        or []
    )
    _log_audit_action(context["user_id"], "PROFILE_UPDATED", "users", context["patient"]["id"])

    row = updated[0] if updated else {**context["user"], "name": payload.name}
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row.get("name"),
        "role": row.get("role"),
    }


@router.get("/booking-options")
def get_booking_options(authorization: Optional[str] = Header(None)):
    _require_patient_context(authorization)

    affiliations = (
        supabase_admin.table("doctor_affiliations")
        .select("*")
        .execute()
        .data
        or []
    )
    active_affiliations = [
        row for row in affiliations if row.get("status", "").lower() != "inactive"
    ]
    doctor_lookup = _doctor_map({row["doctor_id"] for row in active_affiliations})
    organisation_lookup = _organisation_map(
        {row["organisation_id"] for row in active_affiliations}
    )

    return {
        "items": [
            {
                "doctor_id": row["doctor_id"],
                "organisation_id": row["organisation_id"],
                "doctor_name": doctor_lookup.get(row["doctor_id"], {}).get(
                    "display_name", f"Doctor #{row['doctor_id']}"
                ),
                "specialization": doctor_lookup.get(row["doctor_id"], {}).get(
                    "specialization"
                ),
                "organisation_name": organisation_lookup.get(
                    row["organisation_id"], {}
                ).get("name", f"Organisation #{row['organisation_id']}"),
                "status": _title_status(row.get("status")),
            }
            for row in active_affiliations
        ]
    }

@router.get("/available-slots")
def get_available_slots(
    doctor_id: int,
    authorization: Optional[str] = Header(None)
):
    _require_patient_context(authorization)

    slots = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("doctor_id", doctor_id)
        .eq("is_booked", False)
        .order("start_time")
        .execute()
        .data
        or []
    )

    return {"slots": slots}


@router.post("/appointments")
def create_appointment(
    payload: AppointmentCreateRequest,
    authorization: Optional[str] = Header(None)
):
    context = _require_patient_context(authorization)
    patient = context["patient"]

    # Get slot
    slot = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("id", payload.slot_id)
        .eq("is_booked", False)
        .single()
        .execute()
        .data
    )

    if not slot:
        raise HTTPException(status_code=400, detail="Slot not available")

    # ── Double-Booking Prevention (Bihanga B-3.2.2) ───────────────

    # Check 1 — Patient doesn't already have an overlapping appointment
    slot_start = slot["start_time"]
    slot_end   = slot["end_time"]

    patient_conflicts = (
        supabase_admin.table("appointments")
        .select("id, start_time, end_time, status")
        .eq("patient_id", patient["id"])
        .not_.in_("status", ["cancelled", "completed"])
        .lt("start_time", slot_end)
        .gt("end_time", slot_start)
        .execute()
        .data or []
    )

    if patient_conflicts:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "Double booking detected",
                "message": "You already have an appointment during this time slot. "
                           "Please cancel it before booking a new one.",
                "conflict_appointment_id": patient_conflicts[0]["id"]
            }
        )

    # Check 2 — Doctor doesn't already have another patient at same time
    doctor_conflicts = (
        supabase_admin.table("appointments")
        .select("id, start_time, end_time, status")
        .eq("doctor_id", slot["doctor_id"])
        .not_.in_("status", ["cancelled", "completed"])
        .lt("start_time", slot_end)
        .gt("end_time", slot_start)
        .execute()
        .data or []
    )

    if doctor_conflicts:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "Doctor unavailable",
                "message": "This doctor already has an appointment during this time. "
                           "Please choose a different time slot.",
            }
        )


    # Validate doctor affiliation is approved
    affiliation = supabase_admin.table("doctor_affiliations") \
        .select("*") \
        .eq("doctor_id", slot["doctor_id"]) \
        .eq("organisation_id", slot.get("organisation_id")) \
        .execute().data or []

    if not any(a.get("status") == "approved" for a in affiliation):
        raise HTTPException(400, "Doctor not approved for this organisation")

    # Create appointment
    created = (
        supabase_admin.table("appointments")
        .insert({
            "patient_id": patient["id"],
            "doctor_id": slot["doctor_id"],
            "organisation_id": slot.get("organisation_id"),
            "start_time": slot["start_time"],
            "end_time": slot["end_time"],
            "status": "pending",
        })
        .execute()
    )

    if not created.data:
        raise HTTPException(status_code=500, detail="Failed to create appointment")

    appointment = created.data[0]

    # Lock slot
    supabase_admin.table("availability_slots").update({
        "is_booked": True
    }).eq("id", payload.slot_id).execute()

    _log_audit_action(
        context["user_id"],
        "APPOINTMENT_CREATED",
        "appointments",
        appointment["id"]
    )

    doctor_lookup = _doctor_map({appointment["doctor_id"]})
    organisation_lookup = _organisation_map({appointment["organisation_id"]})

    return _format_appointment(appointment, doctor_lookup, organisation_lookup)


@router.patch("/appointments/{appointment_id}")
def update_appointment(
    appointment_id: int,
    payload: AppointmentUpdateRequest,
    authorization: Optional[str] = Header(None),
):
    context = _require_patient_context(authorization)
    patient = context["patient"]

    rows = (
        supabase_admin.table("appointments")
        .select("*")
        .eq("id", appointment_id)
        .eq("patient_id", patient["id"])
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Appointment not found")

    update_data = {}
    if payload.start_time is not None:
        update_data["start_time"] = payload.start_time.isoformat()
    if payload.end_time is not None:
        update_data["end_time"] = payload.end_time.isoformat()
    if payload.status is not None:
        update_data["status"] = payload.status
    if payload.start_time is not None or payload.end_time is not None:
        update_data["status"] = payload.status or "pending"

    updated = (
        supabase_admin.table("appointments")
        .update(update_data)
        .eq("id", appointment_id)
        .eq("patient_id", patient["id"])
        .execute()
        .data
        or []
    )
    row = updated[0] if updated else rows[0]

    _log_audit_action(context["user_id"], "APPOINTMENT_UPDATED", "appointments", appointment_id)

    doctor_lookup = _doctor_map({row["doctor_id"]})
    organisation_lookup = _organisation_map({row["organisation_id"]})
    return _format_appointment(row, doctor_lookup, organisation_lookup)


@router.post("/appointments/{appointment_id}/consent")
def update_consent(
    appointment_id: int,
    payload: ConsentUpdateRequest,
    authorization: Optional[str] = Header(None),
):
    context = _require_patient_context(authorization)
    patient = context["patient"]

    rows = (
        supabase_admin.table("appointments")
        .select("*")
        .eq("id", appointment_id)
        .eq("patient_id", patient["id"])
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Appointment not found")

    appointment = rows[0]
    status = (appointment.get("status") or "").lower()
    if status in {"completed", "cancelled"}:
        raise HTTPException(
            status_code=400,
            detail="Consent can only be changed for active appointments",
        )

    action = "CONSENT_GRANTED" if payload.granted else "CONSENT_REVOKED"
    _log_audit_action(context["user_id"], action, "appointment_consent", appointment_id)

    return {
        "appointment_id": appointment_id,
        "granted": payload.granted,
        "status": "Granted" if payload.granted else "Revoked",
        "last_updated": datetime.now().astimezone().isoformat(),
    }


@router.get("/records")
def list_records(authorization: Optional[str] = Header(None)):
    context = _require_patient_context(authorization)
    patient = context["patient"]

    encounters = (
        supabase_admin.table("encounters")
        .select("*")
        .eq("patient_id", patient["id"])
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    appointment_ids = {row["appointment_id"] for row in encounters if row.get("appointment_id")}
    appointments = (
        supabase_admin.table("appointments")
        .select("*")
        .in_("id", list(appointment_ids))
        .execute()
        .data
        or []
    ) if appointment_ids else []
    appointments_map = {row["id"]: row for row in appointments}
    doctor_lookup = _doctor_map({row["doctor_id"] for row in encounters})
    organisation_lookup = _organisation_map({row["organisation_id"] for row in appointments})

    encounter_ids = [row["id"] for row in encounters]
    prescriptions = (
        supabase_admin.table("prescriptions")
        .select("*")
        .in_("encounter_id", encounter_ids)
        .execute()
        .data
        or []
    ) if encounter_ids else []
    prescriptions_map = {}
    for row in prescriptions:
        prescriptions_map.setdefault(row["encounter_id"], []).append(row)

    prescription_ids = [row["id"] for row in prescriptions]
    items = (
        supabase_admin.table("prescription_items")
        .select("*")
        .in_("prescription_id", prescription_ids)
        .execute()
        .data
        or []
    ) if prescription_ids else []
    items_map = {}
    for row in items:
        items_map.setdefault(row["prescription_id"], []).append(row)

    return {
        "items": [
            _format_record(
                row,
                appointments_map,
                doctor_lookup,
                prescriptions_map,
                items_map,
                organisation_lookup,
            )
            for row in encounters
        ]
    }


@router.get("/pharmacy")
def search_pharmacy(
    authorization: Optional[str] = Header(None),
    query: str = Query(default="", max_length=120),
):
    _require_patient_context(authorization)

    # ── Sanitise search query (Bihanga B-5.1.2) ──────────────────
    safe_query = sanitize_search_query(query, max_length=100)

    inventory_query = supabase_admin.table("inventory").select("*").order("medicine_name")
    if safe_query:
        inventory_query = inventory_query.ilike("medicine_name", f"%{safe_query}%")
    rows = inventory_query.limit(50).execute().data or []

    pharmacy_lookup = {}
    pharmacy_ids = {row["pharmacy_id"] for row in rows}
    if pharmacy_ids:
        pharmacies = (
            supabase_admin.table("pharmacies")
            .select("*")
            .in_("id", list(pharmacy_ids))
            .execute()
            .data
            or []
        )
        pharmacy_lookup = {row["id"]: row for row in pharmacies}

    organisation_lookup = _organisation_map(
        {row["organisation_id"] for row in pharmacy_lookup.values() if row.get("organisation_id")}
    )

    items = []
    for row in rows:
        pharmacy = pharmacy_lookup.get(row["pharmacy_id"], {})
        organisation = organisation_lookup.get(pharmacy.get("organisation_id"), {})
        items.append(
            {
                "id": row["id"],
                "medicine_name": row["medicine_name"],
                "stock_quantity": row["stock_quantity"],
                "unit_price": row["unit_price"],
                "availability": (
                    "Low Stock"
                    if row["stock_quantity"] < 10
                    else "In Stock"
                ),
                "pharmacy": {
                    "id": row["pharmacy_id"],
                    "name": organisation.get("name", f"Pharmacy #{row['pharmacy_id']}"),
                    "organisation_status": organisation.get("status"),
                },
            }
        )

    return {"items": items}


@router.get("/dispensing")
def list_dispensing(authorization: Optional[str] = Header(None)):
    context = _require_patient_context(authorization)
    patient = context["patient"]

    prescriptions = (
        supabase_admin.table("prescriptions")
        .select("*")
        .eq("patient_id", patient["id"])
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    prescription_ids = [row["id"] for row in prescriptions]
    if not prescription_ids:
        return {
            "stats": {
                "dispensing_events": 0,
                "prescriptions_dispensed": 0,
                "total_billed": 0,
            },
            "items": [],
        }

    dispensing_rows = (
        supabase_admin.table("dispensing")
        .select("*")
        .in_("prescription_id", prescription_ids)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    dispensing_ids = [row["id"] for row in dispensing_rows]
    billing_rows = (
        supabase_admin.table("billing")
        .select("*")
        .in_("dispensing_id", dispensing_ids)
        .execute()
        .data
        or []
    ) if dispensing_ids else []
    billing_lookup = {row["dispensing_id"]: row for row in billing_rows}

    dispensing_item_rows = (
        supabase_admin.table("dispensing_items")
        .select("*")
        .in_("dispensing_id", dispensing_ids)
        .execute()
        .data
        or []
    ) if dispensing_ids else []
    prescription_item_ids = {
        row["prescription_item_id"] for row in dispensing_item_rows if row.get("prescription_item_id")
    }
    prescription_item_rows = (
        supabase_admin.table("prescription_items")
        .select("*")
        .in_("id", list(prescription_item_ids))
        .execute()
        .data
        or []
    ) if prescription_item_ids else []
    prescription_item_lookup = {row["id"]: row for row in prescription_item_rows}

    dispensing_items_lookup = {}
    for row in dispensing_item_rows:
        linked_item = prescription_item_lookup.get(row["prescription_item_id"], {})
        dispensing_items_lookup.setdefault(row["dispensing_id"], []).append(
            {
                "id": row["id"],
                "medicine_name": linked_item.get("medicine_name"),
                "dosage": linked_item.get("dosage"),
                "instructions": linked_item.get("instructions"),
                "quantity_dispensed": row.get("quantity_dispensed"),
                "price": row.get("price"),
            }
        )

    pharmacies = (
        supabase_admin.table("pharmacies")
        .select("*")
        .in_("id", list({row["pharmacy_id"] for row in dispensing_rows}))
        .execute()
        .data
        or []
    ) if dispensing_rows else []
    pharmacy_lookup = {row["id"]: row for row in pharmacies}
    organisation_lookup = _organisation_map(
        {
            row["organisation_id"]
            for row in pharmacies
            if row.get("organisation_id")
        }
    )

    items = []
    total_billed = 0
    dispensed_prescriptions = set()

    for row in dispensing_rows:
        billing_row = billing_lookup.get(row["id"])
        billed_total = (
            billing_row.get("total_amount")
            if billing_row
            else row.get("total_price") or 0
        )
        total_billed += billed_total or 0
        dispensed_prescriptions.add(row["prescription_id"])
        pharmacy = pharmacy_lookup.get(row["pharmacy_id"], {})
        organisation = organisation_lookup.get(pharmacy.get("organisation_id"), {})

        items.append(
            {
                "id": row["id"],
                "prescription_id": row["prescription_id"],
                "status": _title_status(row.get("status")),
                "created_at": row.get("created_at"),
                "total_price": row.get("total_price") or 0,
                "billed_total": billed_total or 0,
                "pharmacy": {
                    "id": row["pharmacy_id"],
                    "name": organisation.get("name", f"Pharmacy #{row['pharmacy_id']}"),
                },
                "line_items": dispensing_items_lookup.get(row["id"], []),
            }
        )

    return {
        "stats": {
            "dispensing_events": len(dispensing_rows),
            "prescriptions_dispensed": len(dispensed_prescriptions),
            "total_billed": total_billed,
        },
        "items": items,
    }


@router.post("/assistant/respond")
def assistant_respond(
    payload: AssistantRequest, authorization: Optional[str] = Header(None)
):
    context = _require_patient_context(authorization)
    snapshot = _build_assistant_snapshot(context["patient"], context["user"])

    edge_answer = _call_gemini_edge(payload.message, payload.history, snapshot)
    if edge_answer:
        return {
            "answer": edge_answer,
            "source": "gemini_edge",
        }

    return {
        "answer": _fallback_assistant_answer(payload.message, snapshot),
        "source": "patient_fallback",
    }

@router.get("/lookup/{dhid}")
def lookup_by_dhid(
    dhid: str,
    authorization: Optional[str] = Header(None),
    current_user: dict = Depends(RoleChecker(["doctor", "pharmacist", "hospital_admin"]))
):
    """
    Looks up a patient by their DHID.
    Restricted to doctors, pharmacists and hospital admins only.
    Returns masked NIC — raw NIC hash never returned.
    Protected against ID enumeration (B-3.2.1)
    """
    # ── Validate DHID format and checksum ────────────────────────
    if not validate_dhid(dhid):
        raise HTTPException(
            status_code=400,
            detail="Invalid DHID format or checksum."
        )

    # ── Look up patient ───────────────────────────────────────────
    try:
        patients = (
            supabase_admin.table("patients")
            .select("id, dhid, user_id")
            .eq("dhid", dhid)
            .execute()
            .data or []
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not perform lookup."
        )

    # ── Always return 404 if not found (prevents enumeration) ─────
    # Never reveal whether DHID exists or not to unauthorised callers
    if not patients:
        raise HTTPException(
            status_code=404,
            detail="Patient not found."
        )

    patient = patients[0]

    # ── Get user info ─────────────────────────────────────────────
    try:
        user = (
            supabase_admin.table("users")
            .select("id, name, email")
            .eq("id", patient["user_id"])
            .single()
            .execute()
            .data or {}
        )
    except Exception:
        user = {}

    # ── Log the lookup ────────────────────────────────────────────
    try:
        from datetime import datetime as _dt
        supabase_admin.table("audit_logs").insert({
            "action":    "PATIENT_LOOKUP_BY_DHID",
            "entity":    "patients",
            "entity_id": patient["id"],
            "user_id":   current_user["user_id"],
            "timestamp": _dt.now().astimezone().isoformat(),
        }).execute()
    except Exception:
        pass

    return {
        "patient_id": patient["id"],
        "dhid":       patient["dhid"],
        "name":       user.get("name"),
        "note":       "NIC is not returned via DHID lookup for privacy protection."
    }
