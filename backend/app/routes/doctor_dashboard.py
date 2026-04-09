import json
import os
from datetime import datetime
from typing import Literal, Optional
from urllib import error as urllib_error
from urllib import request as urllib_request

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from app.config.supabase import supabase, supabase_admin

router = APIRouter(prefix="/doctor/dashboard", tags=["doctor-dashboard"])


class ProfileUpdateRequest(BaseModel):
    name: str
    specialization: str
    slmc_number: str

    @field_validator("name", "specialization", "slmc_number")
    @classmethod
    def validate_required_text(cls, value: str):
        cleaned = value.strip()
        if len(cleaned) < 2:
            raise ValueError("Field must be at least 2 characters")
        return cleaned


class EncounterPrescriptionItemRequest(BaseModel):
    medicine_name: str
    dosage: str = ""
    duration: str = ""

    @field_validator("medicine_name")
    @classmethod
    def validate_medicine_name(cls, value: str):
        cleaned = value.strip()
        if len(cleaned) < 2:
            raise ValueError("Medicine name must be at least 2 characters")
        return cleaned

    @field_validator("dosage", "duration")
    @classmethod
    def normalize_optional_text(cls, value: str):
        return value.strip()


class EncounterSubmitRequest(BaseModel):
    patient_id: int
    appointment_id: Optional[int] = None
    diagnosis: str
    encounter_type: str
    clinical_notes: str
    prescription_items: list[EncounterPrescriptionItemRequest] = Field(default_factory=list)

    @field_validator("diagnosis", "encounter_type", "clinical_notes")
    @classmethod
    def validate_text(cls, value: str):
        cleaned = value.strip()
        if len(cleaned) < 2:
            raise ValueError("Field must be at least 2 characters")
        return cleaned

    @model_validator(mode="after")
    def validate_payload(self):
        if len(self.prescription_items) > 25:
            raise ValueError("Prescription item count is too high")
        return self


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
    
class AvailabilitySlotCreateRequest(BaseModel):
    start_time: str
    end_time: str

    @model_validator(mode="after")
    def validate_times(self):
        start = _parse_iso_datetime(self.start_time)
        end = _parse_iso_datetime(self.end_time)

        if not start or not end:
            raise ValueError("Invalid datetime format")

        if end <= start:
            raise ValueError("End time must be after start time")

        return self


class AssistantRequest(BaseModel):
    message: str
    history: list[AssistantHistoryMessage] = Field(default_factory=list)
    patient_id: Optional[int] = None

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


def _require_doctor_context(authorization: Optional[str]):
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

    if not db_user or (db_user.get("role") or "").lower() != "doctor":
        raise HTTPException(status_code=403, detail="Doctor access required")

    try:
        doctor = (
            supabase_admin.table("doctors")
            .select("*")
            .eq("user_id", user_id)
            .single()
            .execute()
            .data
        )
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Doctor profile not found") from exc

    return {
        "token": token,
        "user_id": user_id,
        "user": db_user,
        "doctor": doctor,
    }


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _title_status(value: Optional[str]) -> str:
    return (value or "unknown").replace("_", " ").title()


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


def _patient_map(patient_ids: set[int]):
    if not patient_ids:
        return {}

    rows = (
        supabase_admin.table("patients")
        .select("*")
        .in_("id", list(patient_ids))
        .execute()
        .data
        or []
    )
    user_lookup = _user_map({row["user_id"] for row in rows if row.get("user_id")})

    patient_lookup = {}
    for row in rows:
        linked_user = user_lookup.get(row.get("user_id"), {})
        display_name = (
            linked_user.get("name")
            or linked_user.get("email")
            or f"Patient #{row['id']}"
        )
        patient_lookup[row["id"]] = {
            **row,
            "display_name": display_name,
            "email": linked_user.get("email"),
        }
    return patient_lookup


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

    doctor_lookup = {}
    for row in rows:
        linked_user = user_lookup.get(row.get("user_id"), {})
        doctor_lookup[row["id"]] = {
            **row,
            "display_name": linked_user.get("name")
            or linked_user.get("email")
            or f"Doctor #{row['id']}",
            "email": linked_user.get("email"),
        }
    return doctor_lookup


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


def _format_schedule_item(row, patient_lookup, organisation_lookup, consent_lookup, encounter_lookup):
    patient = patient_lookup.get(row["patient_id"], {})
    organisation = organisation_lookup.get(row["organisation_id"], {})
    consent = consent_lookup.get(row["id"], {})
    appointment_status = _title_status(row.get("status"))
    return {
        "id": row["id"],
        "status": appointment_status,
        "start_time": row.get("start_time"),
        "end_time": row.get("end_time"),
        "patient": {
            "id": row["patient_id"],
            "name": patient.get("display_name", f"Patient #{row['patient_id']}"),
            "dhid": patient.get("dhid"),
            "email": patient.get("email"),
        },
        "organisation": {
            "id": row["organisation_id"],
            "name": organisation.get("name", f"Organisation #{row['organisation_id']}"),
            "type": organisation.get("type"),
            "status": organisation.get("status"),
        },
        "consent": {
            "granted": bool(consent.get("granted")),
            "status": "Active" if consent.get("granted") else "Not Granted",
            "last_updated": consent.get("last_updated"),
        },
        "encounter": encounter_lookup.get(row["id"]),
    }


def _select_active_schedule_item(schedule_items: list[dict]):
    now = datetime.now().astimezone()

    for item in schedule_items:
        status = (item.get("status") or "").lower()
        start_time = _parse_iso_datetime(item.get("start_time"))
        end_time = _parse_iso_datetime(item.get("end_time"))
        if status in {"cancelled", "completed"}:
            continue
        if start_time and end_time and start_time <= now <= end_time:
            return item

    for item in schedule_items:
        status = (item.get("status") or "").lower()
        start_time = _parse_iso_datetime(item.get("start_time"))
        if status in {"cancelled", "completed"}:
            continue
        if start_time and start_time >= now:
            return item

    return schedule_items[0] if schedule_items else None


def _format_patient_history(encounters, doctor_lookup, appointments_map, organisation_lookup):
    items = []
    for row in encounters:
        appointment = appointments_map.get(row.get("appointment_id"))
        organisation = organisation_lookup.get(appointment.get("organisation_id")) if appointment else {}
        doctor = doctor_lookup.get(row.get("doctor_id"), {})
        items.append(
            {
                "id": row["id"],
                "created_at": row.get("created_at"),
                "notes": row.get("notes"),
                "doctor_name": doctor.get("display_name", f"Doctor #{row.get('doctor_id')}"),
                "organisation_name": organisation.get("name"),
                "appointment_status": _title_status(appointment.get("status")) if appointment else None,
            }
        )
    return items


def _build_archives(history_items, latest_prescription):
    archives = []

    for item in history_items[:8]:
        created_at = _parse_iso_datetime(item.get("created_at"))
        created_label = created_at.strftime("%b %d, %Y") if created_at else "Unknown date"
        archives.append(
            {
                "id": f"encounter-{item['id']}",
                "title": f"Encounter Record #{item['id']}",
                "type": "encounter",
                "created_at": item.get("created_at"),
                "meta": f"{created_label} • {item.get('doctor_name') or 'Doctor'}",
            }
        )

    if latest_prescription:
        created_at = _parse_iso_datetime(latest_prescription.get("created_at"))
        created_label = created_at.strftime("%b %d, %Y") if created_at else "Unknown date"
        archives.insert(
            0,
            {
                "id": f"prescription-{latest_prescription['id']}",
                "title": f"Prescription #{latest_prescription['id']}",
                "type": "prescription",
                "created_at": latest_prescription.get("created_at"),
                "meta": f"{created_label} • {_title_status(latest_prescription.get('status'))}",
            },
        )

    return archives


def _build_active_patient_bundle(active_schedule_item, doctor_id: int):
    if not active_schedule_item:
        return None

    patient_id = active_schedule_item["patient"]["id"]
    patient_lookup = _patient_map({patient_id})
    patient = patient_lookup.get(patient_id)
    if not patient:
        return None

    patient_encounters = (
        supabase_admin.table("encounters")
        .select("*")
        .eq("patient_id", patient_id)
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data
        or []
    )
    patient_appointment_ids = {
        row["appointment_id"] for row in patient_encounters if row.get("appointment_id")
    }
    patient_appointments = (
        supabase_admin.table("appointments")
        .select("*")
        .in_("id", list(patient_appointment_ids))
        .execute()
        .data
        or []
    ) if patient_appointment_ids else []
    patient_appointments_map = {row["id"]: row for row in patient_appointments}
    patient_organisation_lookup = _organisation_map(
        {row["organisation_id"] for row in patient_appointments if row.get("organisation_id")}
    )
    patient_doctor_lookup = _doctor_map(
        {row["doctor_id"] for row in patient_encounters if row.get("doctor_id")}
    )

    prescriptions = (
        supabase_admin.table("prescriptions")
        .select("*")
        .eq("patient_id", patient_id)
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data
        or []
    )
    prescription_ids = [row["id"] for row in prescriptions]
    prescription_items = (
        supabase_admin.table("prescription_items")
        .select("*")
        .in_("prescription_id", prescription_ids)
        .execute()
        .data
        or []
    ) if prescription_ids else []
    prescription_items_map = {}
    for item in prescription_items:
        prescription_items_map.setdefault(item["prescription_id"], []).append(item)

    latest_prescription = prescriptions[0] if prescriptions else None
    history_items = _format_patient_history(
        patient_encounters,
        patient_doctor_lookup,
        patient_appointments_map,
        patient_organisation_lookup,
    )
    latest_encounter = patient_encounters[0] if patient_encounters else None

    return {
        "patient": {
            "id": patient["id"],
            "name": patient.get("display_name", f"Patient #{patient['id']}"),
            "dhid": patient.get("dhid"),
            "email": patient.get("email"),
            "created_at": patient.get("created_at"),
        },
        "appointment": active_schedule_item,
        "summary": {
            "medical_records": len(patient_encounters),
            "active_prescriptions": len(
                [row for row in prescriptions if (row.get("status") or "").lower() != "cancelled"]
            ),
            "last_encounter_at": latest_encounter.get("created_at") if latest_encounter else None,
            "doctor_has_previous_records": any(
                row.get("doctor_id") == doctor_id for row in patient_encounters
            ),
        },
        "latest_record": {
            "id": latest_encounter["id"],
            "created_at": latest_encounter.get("created_at"),
            "notes": latest_encounter.get("notes"),
        }
        if latest_encounter
        else None,
        "latest_prescription": {
            "id": latest_prescription["id"],
            "status": _title_status(latest_prescription.get("status")),
            "created_at": latest_prescription.get("created_at"),
            "items": prescription_items_map.get(latest_prescription["id"], []),
        }
        if latest_prescription
        else None,
        "allergies": [],
        "history": history_items,
        "archives": _build_archives(history_items, latest_prescription),
    }


def _build_dashboard_payload(context):
    doctor = context["doctor"]
    user = context["user"]
    doctor_id = doctor["id"]
    now = datetime.now().astimezone()
    today = now.date()

    appointments = (
        supabase_admin.table("appointments")
        .select("*")
        .eq("doctor_id", doctor_id)
        .order("start_time")
        .execute()
        .data
        or []
    )
    affiliations = (
        supabase_admin.table("doctor_affiliations")
        .select("*")
        .eq("doctor_id", doctor_id)
        .execute()
        .data
        or []
    )
    encounters = (
        supabase_admin.table("encounters")
        .select("*")
        .eq("doctor_id", doctor_id)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )

    patient_lookup = _patient_map({row["patient_id"] for row in appointments if row.get("patient_id")})
    organisation_lookup = _organisation_map(
        {row["organisation_id"] for row in appointments if row.get("organisation_id")}
        | {row["organisation_id"] for row in affiliations if row.get("organisation_id")}
    )
    consent_lookup = _consent_state_map({row["id"] for row in appointments})

    encounter_lookup = {}
    for row in encounters:
        appointment_id = row.get("appointment_id")
        if appointment_id and appointment_id not in encounter_lookup:
            encounter_lookup[appointment_id] = {
                "id": row["id"],
                "created_at": row.get("created_at"),
            }

    schedule_items = [
        _format_schedule_item(
            row,
            patient_lookup,
            organisation_lookup,
            consent_lookup,
            encounter_lookup,
        )
        for row in appointments
    ]
    active_schedule_item = _select_active_schedule_item(schedule_items)
    active_patient = _build_active_patient_bundle(active_schedule_item, doctor_id)

    completed_today_patient_ids = set()
    for row in appointments:
        start_time = _parse_iso_datetime(row.get("start_time"))
        status = (row.get("status") or "").lower()
        if start_time and start_time.astimezone().date() == today and status == "completed":
            completed_today_patient_ids.add(row["patient_id"])

    pending_reports = 0
    encounter_appointment_ids = {
        row["appointment_id"] for row in encounters if row.get("appointment_id")
    }
    for row in appointments:
        status = (row.get("status") or "").lower()
        if status == "completed" and row["id"] not in encounter_appointment_ids:
            pending_reports += 1

    affiliation_items = []
    for row in affiliations:
        organisation = organisation_lookup.get(row.get("organisation_id"), {})
        affiliation_items.append(
            {
                "id": row["id"],
                "status": _title_status(row.get("status")),
                "organisation": {
                    "id": row.get("organisation_id"),
                    "name": organisation.get("name", f"Organisation #{row.get('organisation_id')}"),
                    "type": organisation.get("type"),
                },
            }
        )

    return {
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user.get("name"),
        },
        "doctor": {
            "id": doctor["id"],
            "created_at": doctor.get("created_at"),
            "specialization": doctor.get("specialization"),
            "slmc_number": doctor.get("slmc_number"),
        },
        "stats": {
            "scheduled_today": len(
                [
                    row
                    for row in appointments
                    if (
                        _parse_iso_datetime(row.get("start_time"))
                        and _parse_iso_datetime(row.get("start_time")).astimezone().date() == today
                    )
                ]
            ),
            "patients_seen_today": len(completed_today_patient_ids),
            "pending_reports": pending_reports,
            "recorded_encounters": len(encounters),
            "active_affiliations": len(
                [row for row in affiliations if (row.get("status") or "").lower() != "inactive"]
            ),
        },
        "active_patient": active_patient,
        "schedule": schedule_items,
        "affiliations": affiliation_items,
    }


def _extract_edge_answer(payload):
    if isinstance(payload, str):
        return payload.strip() or None

    if isinstance(payload, dict):
        for key in ("answer", "response", "message", "text"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        candidates = payload.get("candidates")
        if isinstance(candidates, list):
            for item in candidates:
                if isinstance(item, dict):
                    content = item.get("content")
                    if isinstance(content, str) and content.strip():
                        return content.strip()

    return None


def _call_gemini_edge(message: str, history: list[AssistantHistoryMessage], snapshot: dict):
    edge_url = os.getenv("GEMINI_EDGE_FUNCTION_URL")
    if not edge_url:
        return None

    token = os.getenv("GEMINI_EDGE_FUNCTION_TOKEN") or os.getenv("SUPABASE_SERVICE_KEY")
    payload = {
        "message": message,
        "history": [{"role": item.role, "text": item.text} for item in history[-12:]],
        "doctor_context": snapshot,
        "patient_context": snapshot.get("active_patient"),
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
    except urllib_error.HTTPError:
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


def _doctor_assistant_fallback(message: str, snapshot: dict) -> str:
    normalized = message.lower()
    stats = snapshot.get("stats", {})
    active_patient = snapshot.get("active_patient")
    schedule = snapshot.get("schedule", [])

    if any(token in normalized for token in ("schedule", "appointment", "queue", "next")):
        if not schedule:
            return (
                "You have no booked appointments yet. Once patient bookings hit the database, "
                "the schedule will show here instead of imaginary nonsense."
            )

        next_item = _select_active_schedule_item(schedule) or schedule[0]
        patient = next_item.get("patient", {})
        start_time = _parse_iso_datetime(next_item.get("start_time"))
        time_label = start_time.astimezone().strftime("%b %d, %I:%M %p") if start_time else "an unknown time"
        return (
            f"Your next active patient is {patient.get('name', 'the patient')} at {time_label}. "
            f"Appointment status is {next_item.get('status', 'Unknown')}."
        )

    if any(token in normalized for token in ("record", "history", "diagnosis", "notes")):
        if not active_patient or not active_patient.get("latest_record"):
            return (
                "There is no saved encounter record for the active patient yet. "
                "Once you submit an encounter, I can summarize it here."
            )

        latest = active_patient["latest_record"]
        if latest.get("notes"):
            return f"Latest encounter note says: {latest['notes']}"
        return "A latest encounter exists, but it does not include clinical notes yet."

    if any(token in normalized for token in ("medicine", "prescription", "drug")):
        if not active_patient or not active_patient.get("latest_prescription"):
            return "There is no saved prescription for the active patient yet."

        items = active_patient["latest_prescription"].get("items", [])
        if not items:
            return "The latest prescription exists, but it has no line items yet."

        medicines = ", ".join(
            f"{item.get('medicine_name')} ({item.get('dosage') or 'no dosage'})"
            for item in items
            if item.get("medicine_name")
        )
        return f"Latest prescription contains: {medicines}."

    if any(token in normalized for token in ("consent", "access")):
        if not active_patient:
            return "There is no active patient selected, so no consent state is available yet."

        consent = active_patient.get("appointment", {}).get("consent", {})
        return f"Consent is currently {consent.get('status', 'Unknown')} for the active appointment."

    if any(token in normalized for token in ("summary", "dashboard", "today")):
        return (
            f"Today you have {stats.get('scheduled_today', 0)} scheduled appointments, "
            f"{stats.get('patients_seen_today', 0)} patients seen, and "
            f"{stats.get('pending_reports', 0)} pending reports."
        )

    if not active_patient:
        return (
            "I can summarize your schedule, consent status, patient history, and latest prescriptions. "
            "Right now there is no active patient loaded from the database yet."
        )

    patient = active_patient.get("patient", {})
    return (
        f"I can help with {patient.get('name', 'the active patient')}'s latest record, prescriptions, "
        "consent status, and your schedule. Ask one of those and I will answer from saved data."
    )


@router.get("")
def get_doctor_dashboard(authorization: Optional[str] = Header(None)):
    context = _require_doctor_context(authorization)
    return _build_dashboard_payload(context)


@router.patch("/profile")
def update_doctor_profile(
    payload: ProfileUpdateRequest,
    authorization: Optional[str] = Header(None),
):
    context = _require_doctor_context(authorization)

    updated_user = (
        supabase_admin.table("users")
        .update({"name": payload.name})
        .eq("id", context["user_id"])
        .execute()
        .data
        or []
    )
    updated_doctor = (
        supabase_admin.table("doctors")
        .update(
            {
                "specialization": payload.specialization,
                "slmc_number": payload.slmc_number,
            }
        )
        .eq("id", context["doctor"]["id"])
        .execute()
        .data
        or []
    )

    _log_audit_action(
        context["user_id"],
        "DOCTOR_PROFILE_UPDATED",
        "doctors",
        context["doctor"]["id"],
    )

    user_row = updated_user[0] if updated_user else {**context["user"], "name": payload.name}
    doctor_row = (
        updated_doctor[0]
        if updated_doctor
        else {
            **context["doctor"],
            "specialization": payload.specialization,
            "slmc_number": payload.slmc_number,
        }
    )
    return {
        "user": {
            "id": user_row["id"],
            "email": user_row["email"],
            "name": user_row.get("name"),
        },
        "doctor": {
            "id": doctor_row["id"],
            "specialization": doctor_row.get("specialization"),
            "slmc_number": doctor_row.get("slmc_number"),
        },
    }


@router.post("/encounters/submit")
def submit_encounter(
    payload: EncounterSubmitRequest,
    authorization: Optional[str] = Header(None),
):
    context = _require_doctor_context(authorization)
    doctor = context["doctor"]

    patient_rows = (
        supabase_admin.table("patients")
        .select("*")
        .eq("id", payload.patient_id)
        .execute()
        .data
        or []
    )
    if not patient_rows:
        raise HTTPException(status_code=404, detail="Patient not found")

    appointment = None
    if payload.appointment_id is not None:
        appointment_rows = (
            supabase_admin.table("appointments")
            .select("*")
            .eq("id", payload.appointment_id)
            .eq("doctor_id", doctor["id"])
            .eq("patient_id", payload.patient_id)
            .execute()
            .data
            or []
        )
        if not appointment_rows:
            raise HTTPException(status_code=404, detail="Appointment not found for this doctor and patient")
        appointment = appointment_rows[0]

    compiled_notes = (
        f"Diagnosis: {payload.diagnosis}\n"
        f"Encounter Type: {payload.encounter_type}\n\n"
        f"{payload.clinical_notes}"
    )

    encounter_rows = (
        supabase_admin.table("encounters")
        .insert(
            {
                "patient_id": payload.patient_id,
                "doctor_id": doctor["id"],
                "appointment_id": payload.appointment_id,
                "notes": compiled_notes,
            }
        )
        .execute()
        .data
        or []
    )
    if not encounter_rows:
        raise HTTPException(status_code=500, detail="Encounter could not be saved")

    encounter = encounter_rows[0]
    prescription = None
    if payload.prescription_items:
        prescription_rows = (
            supabase_admin.table("prescriptions")
            .insert(
                {
                    "patient_id": payload.patient_id,
                    "doctor_id": doctor["id"],
                    "encounter_id": encounter["id"],
                    "status": "active",
                }
            )
            .execute()
            .data
            or []
        )
        if prescription_rows:
            prescription = prescription_rows[0]
            supabase_admin.table("prescription_items").insert(
                [
                    {
                        "prescription_id": prescription["id"],
                        "medicine_name": item.medicine_name,
                        "dosage": item.dosage,
                        "quantity": item.duration or "As directed",
                        "instructions": (
                            f"Encounter type: {payload.encounter_type}"
                            if payload.encounter_type
                            else ""
                        ),
                    }
                    for item in payload.prescription_items
                ]
            ).execute()

    if appointment is not None:
        supabase_admin.table("appointments").update({"status": "completed"}).eq(
            "id", appointment["id"]
        ).execute()

    _log_audit_action(context["user_id"], "ENCOUNTER_SUBMITTED", "encounters", encounter["id"])
    if prescription:
        _log_audit_action(
            context["user_id"],
            "PRESCRIPTION_CREATED",
            "prescriptions",
            prescription["id"],
        )

    return {
        "success": True,
        "encounter_id": encounter["id"],
        "prescription_id": prescription["id"] if prescription else None,
        "message": "Encounter and prescription saved",
    }


@router.post("/assistant/respond")
def doctor_assistant_respond(
    payload: AssistantRequest, authorization: Optional[str] = Header(None)
):
    context = _require_doctor_context(authorization)
    snapshot = _build_dashboard_payload(context)

    if payload.patient_id and snapshot.get("active_patient"):
        active_patient = snapshot["active_patient"].get("patient", {})
        if active_patient.get("id") != payload.patient_id:
            schedule = snapshot.get("schedule", [])
            matching = next(
                (item for item in schedule if item.get("patient", {}).get("id") == payload.patient_id),
                None,
            )
            if matching:
                snapshot["active_patient"] = _build_active_patient_bundle(matching, context["doctor"]["id"])

    edge_answer = _call_gemini_edge(payload.message, payload.history, snapshot)
    if edge_answer:
        return {
            "answer": edge_answer,
            "source": "gemini_edge",
        }

    return {
        "answer": _doctor_assistant_fallback(payload.message, snapshot),
        "source": "doctor_fallback",
    }

@router.post("/availability")
def create_availability_slot(
    payload: AvailabilitySlotCreateRequest,
    authorization: Optional[str] = Header(None),
):
    context = _require_doctor_context(authorization)
    doctor_id = context["doctor"]["id"]

    start = payload.start_time
    end = payload.end_time

    # Prevent overlapping slots
    existing = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("doctor_id", doctor_id)
        .lt("start_time", end)
        .gt("end_time", start)
        .execute()
        .data
        or []
    )

    if existing:
        raise HTTPException(status_code=400, detail="Slot overlaps with existing availability")

    slot = (
        supabase_admin.table("availability_slots")
        .insert({
            "doctor_id": doctor_id,
            "start_time": start,
            "end_time": end,
        })
        .execute()
        .data
    )

    return {
        "success": True,
        "slot": slot[0] if slot else None
    }

@router.get("/availability")
def get_availability(authorization: Optional[str] = Header(None)):
    context = _require_doctor_context(authorization)
    doctor_id = context["doctor"]["id"]

    slots = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("doctor_id", doctor_id)
        .order("start_time")
        .execute()
        .data
        or []
    )

    return {"slots": slots}

@router.delete("/availability/{slot_id}")
def delete_slot(slot_id: int, authorization: Optional[str] = Header(None)):
    context = _require_doctor_context(authorization)
    doctor_id = context["doctor"]["id"]

    slot = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("id", slot_id)
        .eq("doctor_id", doctor_id)
        .execute()
        .data
        or []
    )

    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")

    if slot[0].get("is_booked"):
        raise HTTPException(status_code=400, detail="Cannot delete a booked slot")

    supabase_admin.table("availability_slots").delete().eq("id", slot_id).execute()

    return {"success": True}
