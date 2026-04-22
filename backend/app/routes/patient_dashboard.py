import json
import os
import re
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator

from app.config.supabase import execute_with_retry, supabase, supabase_admin
from app.middleware.ai_anonymiser import anonymise_and_check
from app.middleware.role_checker import RoleChecker, build_user_context
from app.utils.helpers import validate_dhid, mask_nic, sanitize_search_query
from app.utils.gemini_client import call_gemini_assistant
from app.middleware.ai_disclaimer import build_safe_response

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

    user_context = build_user_context(user_id, token=token, auth_user=auth_user.user)
    if user_context.get("role") != "patient":
        raise HTTPException(status_code=403, detail="Patient access required")

    try:
        patient_rows = execute_with_retry(
            lambda: (
                supabase_admin.table("patients")
                .select("*")
                .eq("user_id", user_id)
                .execute()
                .data
            ),
            default=[],
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Patient profile could not be loaded right now. Please retry.",
        ) from exc

    patient = patient_rows[0] if patient_rows else None
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found")

    return {
        **user_context,
        "user": {
            "id": user_context["id"],
            "email": user_context.get("email"),
            "role": user_context.get("role"),
            "name": user_context.get("name"),
        },
        "patient": patient,
    }


def _title_status(value: Optional[str]) -> str:
    return (value or "unknown").replace("_", " ").title()


def _user_map(user_ids: set[str]):
    if not user_ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("users")
            .select("*")
            .in_("id", list(user_ids))
            .execute()
            .data
            or []
        ),
        default=[],
    )
    return {row["id"]: row for row in rows}


def _doctor_map(doctor_ids: set[int]):
    if not doctor_ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("doctors")
            .select("*")
            .in_("id", list(doctor_ids))
            .execute()
            .data
            or []
        ),
        default=[],
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

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("organisations")
            .select("*")
            .in_("id", list(organisation_ids))
            .execute()
            .data
            or []
        ),
        default=[],
    )
    return {row["id"]: row for row in rows}


def _medicine_map(medicine_ids: set[int]):
    if not medicine_ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("medicines")
            .select("id, name, unit, wholesale_price, retail_price")
            .in_("id", list(medicine_ids))
            .execute()
            .data
            or []
        ),
        default=[],
    )
    return {row["id"]: row for row in rows}


def _inventory_medicine_name(row: dict, medicine_lookup: dict[int, dict]) -> str:
    medicine = medicine_lookup.get(row.get("medicine_id"), {})
    return (
        medicine.get("name")
        or row.get("medicine_name")
        or row.get("drug_name")
        or f"Medicine #{row.get('medicine_id') or row.get('id')}"
    )


def _inventory_unit_price(row: dict, medicine_lookup: dict[int, dict]):
    medicine = medicine_lookup.get(row.get("medicine_id"), {})
    return (
        row.get("unit_price")
        or medicine.get("retail_price")
        or medicine.get("wholesale_price")
        or 0
    )


def _normalize_medicine_key(value: Optional[str]) -> str:
    normalized = re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()
    return re.sub(r"\s+", " ", normalized)


def _coerce_positive_int(value) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, float) and value.is_integer() and value > 0:
        return int(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = int(float(value.strip()))
            return parsed if parsed > 0 else None
        except ValueError:
            return None
    return None


def _prescription_quantity_value(item: dict) -> int:
    direct_quantity = _coerce_positive_int(item.get("quantity"))
    if direct_quantity is not None:
        return direct_quantity

    instructions = item.get("instructions") or ""
    for pattern in (
        r"Quantity:\s*(\d+)",
        r"Qty:\s*(\d+)",
        r"Duration:\s*(\d+)",
    ):
        quantity_match = re.search(pattern, instructions, re.IGNORECASE)
        if quantity_match:
            parsed_quantity = _coerce_positive_int(quantity_match.group(1))
            if parsed_quantity is not None:
                return parsed_quantity

    return 1


def _build_inventory_name_index(rows: list[dict], medicine_lookup: dict[int, dict]):
    entries = []
    by_key = {}

    for row in rows:
        medicine_name = _inventory_medicine_name(row, medicine_lookup)
        normalized_name = _normalize_medicine_key(medicine_name)
        entry = {
            **row,
            "medicine_name": medicine_name,
            "normalized_name": normalized_name,
            "unit_price": _inventory_unit_price(row, medicine_lookup),
            "stock_quantity": int(row.get("stock_quantity") or 0),
        }
        entries.append(entry)
        if normalized_name:
            by_key.setdefault(normalized_name, []).append(entry)

    return entries, by_key


def _match_inventory_entry(medicine_name: Optional[str], inventory_entries: list[dict], by_key: dict[str, list[dict]]):
    normalized_target = _normalize_medicine_key(medicine_name)
    if not normalized_target:
        return None

    direct_matches = by_key.get(normalized_target, [])
    if direct_matches:
        return sorted(
            direct_matches,
            key=lambda item: (-item["stock_quantity"], item["unit_price"] or 0),
        )[0]

    fuzzy_matches = [
        entry
        for entry in inventory_entries
        if normalized_target in entry["normalized_name"]
        or entry["normalized_name"] in normalized_target
    ]
    if len(fuzzy_matches) == 1:
        return fuzzy_matches[0]

    return None


def _hospital_map(hospital_ids: set[int]):
    if not hospital_ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("hospitals")
            .select("*")
            .in_("id", list(hospital_ids))
            .execute()
            .data
            or []
        ),
        default=[],
    )
    return {row["id"]: row for row in rows}


def _approved_affiliations_by_doctor():
    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("doctor_affiliations")
            .select("*")
            .execute()
            .data
            or []
        ),
        default=[],
    )
    approved_by_doctor = {}
    for row in rows:
        if (row.get("status") or "").lower() not in {"approved", "active"}:
            continue
        doctor_id = row.get("doctor_id")
        hospital_id = row.get("hospital_id")
        if not doctor_id or not hospital_id:
            continue
        approved_by_doctor.setdefault(doctor_id, []).append(row)
    return approved_by_doctor


def _resolve_slot_organisation_id(
    slot: dict,
    approved_affiliations_by_doctor: dict[int, list[dict]],
    hospital_lookup: dict[int, dict],
):
    organisation_id = slot.get("organisation_id")
    if organisation_id:
        return organisation_id

    hospital_id = slot.get("hospital_id")
    if hospital_id:
        hospital = hospital_lookup.get(hospital_id)
        if hospital:
            return hospital.get("organisation_id")

    doctor_id = slot.get("doctor_id")
    if not doctor_id:
        return None

    approved = approved_affiliations_by_doctor.get(doctor_id, [])
    if len(approved) == 1:
        hospital = hospital_lookup.get(approved[0].get("hospital_id"))
        if hospital:
            return hospital.get("organisation_id")

    return None


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
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            parsed = parsed.replace(tzinfo=datetime.now().astimezone().tzinfo)
        return parsed
    except ValueError:
        return None


def _assistant_datetime_label(value: Optional[str]) -> str:
    parsed = _parse_iso_datetime(value)
    if not parsed:
        return "an unscheduled time"
    return parsed.astimezone().strftime("%b %d, %Y at %I:%M %p")


def _prescription_quantity_label(item: dict) -> Optional[str]:
    quantity = item.get("quantity")
    if quantity not in (None, ""):
        return str(quantity)

    instructions = item.get("instructions") or ""
    for pattern in (
        r"Quantity:\s*([^|]+)",
        r"Qty:\s*([^|]+)",
        r"Duration:\s*([^|]+)",
    ):
        match = re.search(pattern, instructions, re.IGNORECASE)
        if match:
            return match.group(1).strip()

    return None


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

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("audit_logs")
            .select("*")
            .eq("entity", "appointment_consent")
            .in_("entity_id", list(appointment_ids))
            .order("timestamp", desc=True)
            .execute()
            .data
            or []
        ),
        default=[],
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

    approved_affiliations_by_doctor = _approved_affiliations_by_doctor()
    active_affiliations = [
        row
        for items in approved_affiliations_by_doctor.values()
        for row in items
    ]
    booking_doctor_ids = {row["doctor_id"] for row in active_affiliations if row.get("doctor_id")}
    booking_hospital_lookup = _hospital_map(
        {row["hospital_id"] for row in active_affiliations if row.get("hospital_id")}
    )
    booking_org_ids = {
        row["organisation_id"] for row in booking_hospital_lookup.values() if row.get("organisation_id")
    }
    booking_doctor_lookup = _doctor_map(booking_doctor_ids)
    booking_org_lookup = _organisation_map(booking_org_ids)

    booking_options = [
        {
            "doctor_id": row["doctor_id"],
            "organisation_id": booking_hospital_lookup.get(row["hospital_id"], {}).get("organisation_id"),
            "doctor_name": booking_doctor_lookup.get(row["doctor_id"], {}).get(
                "display_name", f"Doctor #{row['doctor_id']}"
            ),
            "specialization": booking_doctor_lookup.get(row["doctor_id"], {}).get(
                "specialization"
            ),
            "organisation_name": booking_org_lookup.get(
                booking_hospital_lookup.get(row["hospital_id"], {}).get("organisation_id"), {}
            ).get("name", f"Hospital #{row['hospital_id']}"),
        }
        for row in active_affiliations
        if booking_hospital_lookup.get(row["hospital_id"], {}).get("organisation_id")
    ]

    availability_rows = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("is_booked", False)
        .in_("doctor_id", list(booking_doctor_ids))
        .order("start_time")
        .execute()
        .data
        or []
    ) if booking_doctor_ids else []

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
            "quantity": _prescription_quantity_label(item),
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
    available_doctors = []
    seen_doctors = set()
    for slot in availability_rows:
        doctor_id = slot.get("doctor_id")
        if not doctor_id or doctor_id in seen_doctors:
            continue

        start_time = _parse_iso_datetime(slot.get("start_time"))
        end_time = _parse_iso_datetime(slot.get("end_time"))
        if not start_time or not end_time or end_time < now:
            continue

        seen_doctors.add(doctor_id)
        doctor = booking_doctor_lookup.get(doctor_id, {})
        resolved_organisation_id = _resolve_slot_organisation_id(
            slot,
            approved_affiliations_by_doctor,
            booking_hospital_lookup,
        )
        organisation = booking_org_lookup.get(resolved_organisation_id, {})
        available_doctors.append(
            {
                "doctor_id": doctor_id,
                "doctor_name": doctor.get("display_name", f"Doctor #{doctor_id}"),
                "specialization": doctor.get("specialization"),
                "organisation_name": organisation.get(
                    "name",
                    (
                        f"Organisation #{resolved_organisation_id}"
                        if resolved_organisation_id
                        else "Hospital assignment pending"
                    ),
                ),
                "start_time": slot.get("start_time"),
                "end_time": slot.get("end_time"),
            }
        )

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
        "booking_options": booking_options[:12],
        "available_doctors": available_doctors[:8],
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


def _call_gemini_ai(message: str, history: list[AssistantHistoryMessage], snapshot: dict):
    safe_snapshot = anonymise_and_check(snapshot, context="patient")
    return call_gemini_assistant(
        {
            "message": message,
            "history": [{"role": item.role, "text": item.text} for item in history[-12:]],
            "patient_context": safe_snapshot,
        }
    )


def _fallback_assistant_answer(message: str, snapshot: dict) -> str:
    normalized = message.lower()
    latest_record = snapshot.get("latest_record")
    next_appointment = snapshot.get("next_appointment")
    latest_prescription = snapshot.get("latest_prescription")
    patient = snapshot.get("patient", {})
    available_doctors = snapshot.get("available_doctors", [])
    booking_options = snapshot.get("booking_options", [])

    if any(
        token in normalized
        for token in (
            "bada",
            "stomach",
            "belly",
            "pain",
            "ache",
            "fever",
            "headache",
            "cough",
            "symptom",
            "specialist",
            "specialty",
            "speciality",
            "meet wenna",
            "kawda meet",
            "which doctor",
            "who should i see",
        )
    ):
        specializations = [
            item.get("specialization")
            for item in booking_options
            if item.get("specialization")
        ]
        lower_specializations = {item.lower(): item for item in specializations}

        if any(token in normalized for token in ("bada", "stomach", "belly", "abdomen")):
            preferred = (
                lower_specializations.get("general medicine")
                or lower_specializations.get("internal medicine")
                or lower_specializations.get("general practitioner")
            )
            if preferred:
                return (
                    f"For stomach or abdominal discomfort, a good first stop is {preferred}. "
                    "If the pain is severe, constant, or comes with vomiting, bleeding, fainting, or trouble breathing, seek urgent care immediately."
                )
            return (
                "For stomach or abdominal discomfort, start with a general doctor or physician if one is available. "
                "If the pain is severe, constant, or comes with vomiting, bleeding, fainting, or trouble breathing, seek urgent care immediately."
            )

        if specializations:
            return (
                "The best doctor depends on the symptom pattern, but from the current booking list these specialties exist: "
                f"{', '.join(sorted(set(specializations))[:6])}."
            )

        return (
            "The best doctor depends on the symptoms, but I cannot see a specialist list in the saved booking data right now."
        )

    if any(token in normalized for token in ("doctor", "doctors", "specialist", "specialty", "speciality", "available")):
        if available_doctors:
            doctor_summary = "; ".join(
                f"{item.get('doctor_name')} ({item.get('specialization') or 'General'}) at "
                f"{item.get('organisation_name')} - next slot {_assistant_datetime_label(item.get('start_time'))}"
                for item in available_doctors[:3]
            )
            return (
                f"I found {len(available_doctors)} doctor(s) with open slots in the saved availability data. "
                f"Closest options: {doctor_summary}."
            )

        if booking_options:
            specialties = sorted(
                {
                    item.get("specialization")
                    for item in booking_options
                    if item.get("specialization")
                }
            )
            if specialties:
                return (
                    "I cannot see a live free slot right now, but the current booking list includes these specialties: "
                    f"{', '.join(specialties[:6])}."
                )
            return "I can see active doctor booking links, but no free slot is visible right now."

        return "I cannot see any active doctor availability in the saved booking data right now."

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
            " - ".join(
                part
                for part in [
                    item.get("medicine_name"),
                    (
                        ", ".join(
                            piece
                            for piece in [
                                item.get("dosage") or "As directed",
                                _prescription_quantity_label(item),
                            ]
                            if piece
                        )
                    ),
                ]
                if part
            )
            for item in items
            if item.get("medicine_name")
        )
        return f"Your latest prescription lists: {medicines}."

    if (
        "dhid" in normalized
        or "digital health id" in normalized
        or "digital id" in normalized
        or "health id" in normalized
        or re.search(r"\byour id\b|\bmy id\b|\bhealth id\b", normalized)
    ):
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

    appointments = execute_with_retry(
        lambda: (
            supabase_admin.table("appointments")
            .select("*")
            .eq("patient_id", patient["id"])
            .order("start_time")
            .execute()
            .data
            or []
        ),
        default=[],
    )
    encounters = execute_with_retry(
        lambda: (
            supabase_admin.table("encounters")
            .select("*")
            .eq("patient_id", patient["id"])
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    prescriptions = execute_with_retry(
        lambda: (
            supabase_admin.table("prescriptions")
            .select("*")
            .eq("patient_id", patient["id"])
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    inventory_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("inventory")
            .select("*", count="exact")
            .limit(1)
            .execute()
        ),
        default=lambda: type("InventoryResult", (), {"count": 0})(),
    )

    doctor_lookup = _doctor_map({row["doctor_id"] for row in appointments})
    organisation_lookup = _organisation_map({row["organisation_id"] for row in appointments})
    consent_lookup = _consent_state_map({row["id"] for row in appointments})
    now = datetime.now().astimezone()
    upcoming = next(
        (
            row
            for row in appointments
            if row.get("status") != "cancelled"
            and (start_time := _parse_iso_datetime(row.get("start_time")))
            and start_time >= now
        ),
        None,
    )

    recent_encounter = encounters[0] if encounters else None
    recent_appointment_map = {
        row["id"]: row
        for row in execute_with_retry(
            lambda: (
                supabase_admin.table("appointments")
                .select("*")
                .in_("id", [recent_encounter["appointment_id"]])
                .execute()
                .data
                or []
            ),
            default=[],
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
                    and (start_time := _parse_iso_datetime(row.get("start_time")))
                    and start_time >= now
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

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("appointments")
            .select("*")
            .eq("patient_id", patient["id"])
            .order("start_time")
            .execute()
            .data
            or []
        ),
        default=[],
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

    affiliations = execute_with_retry(
        lambda: (
            supabase_admin.table("doctor_affiliations")
            .select("*")
            .execute()
            .data
            or []
        ),
        default=[],
    )
    active_affiliations = [
        row
        for row in affiliations
        if row.get("doctor_id")
        and row.get("hospital_id")
        and row.get("status", "").lower() in {"approved", "active"}
    ]
    hospital_lookup = _hospital_map(
        {row["hospital_id"] for row in active_affiliations}
    )
    doctor_lookup = _doctor_map({row["doctor_id"] for row in active_affiliations})
    organisation_lookup = _organisation_map(
        {
            hospital_lookup.get(row["hospital_id"], {}).get("organisation_id")
            for row in active_affiliations
            if hospital_lookup.get(row["hospital_id"], {}).get("organisation_id")
        }
    )

    return {
        "items": [
            {
                "doctor_id": row["doctor_id"],
                "organisation_id": hospital_lookup.get(row["hospital_id"], {}).get(
                    "organisation_id"
                ),
                "doctor_name": doctor_lookup.get(row["doctor_id"], {}).get(
                    "display_name", f"Doctor #{row['doctor_id']}"
                ),
                "specialization": doctor_lookup.get(row["doctor_id"], {}).get(
                    "specialization"
                ),
                "organisation_name": organisation_lookup.get(
                    hospital_lookup.get(row["hospital_id"], {}).get("organisation_id"),
                    {},
                ).get(
                    "name",
                    f"Hospital #{row['hospital_id']}",
                ),
                "status": _title_status(row.get("status")),
            }
            for row in active_affiliations
            if hospital_lookup.get(row["hospital_id"], {}).get("organisation_id")
        ]
    }

@router.get("/available-slots")
def get_available_slots(
    doctor_id: int,
    authorization: Optional[str] = Header(None)
):
    _require_patient_context(authorization)

    raw_slots = execute_with_retry(
        lambda: (
            supabase_admin.table("availability_slots")
            .select("*")
            .eq("doctor_id", doctor_id)
            .eq("is_booked", False)
            .order("start_time")
            .execute()
            .data
            or []
        ),
        default=[],
    )

    approved_affiliations_by_doctor = _approved_affiliations_by_doctor()
    hospital_lookup = _hospital_map(
        {
            row["hospital_id"]
            for row in approved_affiliations_by_doctor.get(doctor_id, [])
            if row.get("hospital_id")
        }
    )

    slots = []
    for row in raw_slots:
        resolved_organisation_id = _resolve_slot_organisation_id(
            row,
            approved_affiliations_by_doctor,
            hospital_lookup,
        )
        slots.append(
            {
                **row,
                "organisation_id": resolved_organisation_id,
            }
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

    approved_affiliations_by_doctor = _approved_affiliations_by_doctor()
    approved_affiliations = approved_affiliations_by_doctor.get(slot["doctor_id"], [])
    hospital_lookup = _hospital_map(
        {row["hospital_id"] for row in approved_affiliations if row.get("hospital_id")}
    )
    resolved_organisation_id = _resolve_slot_organisation_id(
        slot,
        approved_affiliations_by_doctor,
        hospital_lookup,
    )

    if not approved_affiliations:
        raise HTTPException(400, "Doctor is not approved for any hospital yet")

    if not resolved_organisation_id:
        raise HTTPException(
            status_code=409,
            detail=(
                "This doctor has multiple hospital affiliations, but the selected slot is not linked "
                "to one hospital in the current schema. Ask the doctor to keep one active hospital or update the slot model."
            ),
        )

    if not any(
        (
            hospital_lookup.get(row.get("hospital_id"), {}).get("organisation_id")
            == resolved_organisation_id
        )
        and (row.get("status") or "").lower() in {"approved", "active"}
        for row in approved_affiliations
    ):
        raise HTTPException(400, "Doctor not approved for this organisation")

    # Create appointment
    created = (
        supabase_admin.table("appointments")
        .insert({
            "patient_id": patient["id"],
            "doctor_id": slot["doctor_id"],
            "organisation_id": resolved_organisation_id,
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

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("inventory")
            .select("id, pharmacy_id, medicine_id, stock_quantity, unit_price, created_at")
            .order("created_at", desc=True)
            .limit(200)
            .execute()
            .data
            or []
        ),
        default=[],
    )

    medicine_lookup = _medicine_map(
        {row["medicine_id"] for row in rows if row.get("medicine_id")}
    )

    if safe_query:
        normalized_query = safe_query.lower()
        rows = [
            row
            for row in rows
            if normalized_query in _inventory_medicine_name(row, medicine_lookup).lower()
        ]

    rows = sorted(
        rows,
        key=lambda row: _inventory_medicine_name(row, medicine_lookup).lower(),
    )[:50]

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
        stock_quantity = int(row.get("stock_quantity") or 0)
        unit_price = _inventory_unit_price(row, medicine_lookup)
        items.append(
            {
                "id": row["id"],
                "medicine_name": _inventory_medicine_name(row, medicine_lookup),
                "stock_quantity": stock_quantity,
                "unit_price": unit_price,
                "availability": (
                    "Low Stock"
                    if stock_quantity < 10
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


@router.get("/pharmacies")
def list_patient_pharmacies(
    authorization: Optional[str] = Header(None),
):
    _require_patient_context(authorization)

    pharmacy_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("pharmacies")
            .select("id, organisation_id")
            .order("id")
            .execute()
            .data
            or []
        ),
        default=[],
    )

    organisation_lookup = _organisation_map(
        {row["organisation_id"] for row in pharmacy_rows if row.get("organisation_id")}
    )

    inventory_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("inventory")
            .select("pharmacy_id")
            .execute()
            .data
            or []
        ),
        default=[],
    )

    indexed_counts: dict[int, int] = {}
    for row in inventory_rows:
        pharmacy_id = row.get("pharmacy_id")
        if pharmacy_id is None:
            continue
        indexed_counts[pharmacy_id] = indexed_counts.get(pharmacy_id, 0) + 1

    items = []
    for row in pharmacy_rows:
        organisation = organisation_lookup.get(row.get("organisation_id"), {})
        items.append(
            {
                "id": row["id"],
                "name": organisation.get("name", f"Pharmacy #{row['id']}"),
                "organisation_status": organisation.get("status"),
                "indexed_items": indexed_counts.get(row["id"], 0),
            }
        )

    items.sort(key=lambda item: item["name"].lower())
    return {"items": items}


@router.get("/pharmacy/estimate")
def estimate_pharmacy_bill(
    prescription_id: int = Query(..., gt=0),
    pharmacy_id: int = Query(..., gt=0),
    authorization: Optional[str] = Header(None),
):
    context = _require_patient_context(authorization)
    patient = context["patient"]

    prescription_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("prescriptions")
            .select("*")
            .eq("id", prescription_id)
            .eq("patient_id", patient["id"])
            .limit(1)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    if not prescription_rows:
        raise HTTPException(status_code=404, detail="Prescription not found")

    prescription = prescription_rows[0]
    prescription_items = execute_with_retry(
        lambda: (
            supabase_admin.table("prescription_items")
            .select("*")
            .eq("prescription_id", prescription_id)
            .execute()
            .data
            or []
        ),
        default=[],
    )

    pharmacy_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("pharmacies")
            .select("*")
            .eq("id", pharmacy_id)
            .limit(1)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    if not pharmacy_rows:
        raise HTTPException(status_code=404, detail="Pharmacy not found")

    pharmacy = pharmacy_rows[0]
    organisation_lookup = _organisation_map(
        {pharmacy["organisation_id"]} if pharmacy.get("organisation_id") else set()
    )
    pharmacy_organisation = organisation_lookup.get(pharmacy.get("organisation_id"), {})

    inventory_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("inventory")
            .select("id, pharmacy_id, medicine_id, stock_quantity, unit_price, created_at")
            .eq("pharmacy_id", pharmacy_id)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    medicine_lookup = _medicine_map(
        {row["medicine_id"] for row in inventory_rows if row.get("medicine_id")}
    )
    inventory_entries, inventory_by_key = _build_inventory_name_index(
        inventory_rows,
        medicine_lookup,
    )

    doctor_lookup = _doctor_map(
        {prescription["doctor_id"]} if prescription.get("doctor_id") else set()
    )
    doctor = doctor_lookup.get(prescription.get("doctor_id"), {})

    estimated_total = 0.0
    included_items = 0
    unavailable_items = 0
    estimate_items = []

    for item in prescription_items:
        medicine_name = item.get("medicine_name") or f"Prescription item #{item['id']}"
        quantity_value = _prescription_quantity_value(item)
        quantity_label = _prescription_quantity_label(item) or str(quantity_value)
        inventory_entry = _match_inventory_entry(
            medicine_name,
            inventory_entries,
            inventory_by_key,
        )

        availability_status = "available"
        availability_label = "Included in estimate"
        note = None
        unit_price = None
        line_total = None
        matched_inventory_id = None
        stock_quantity = inventory_entry.get("stock_quantity", 0) if inventory_entry else 0

        if not inventory_entry:
            availability_status = "not_listed"
            availability_label = "Not stocked here"
            note = "This medicine is not listed in the selected pharmacy inventory."
        elif stock_quantity <= 0:
            availability_status = "out_of_stock"
            availability_label = "Out of stock"
            note = "The pharmacy catalog has this medicine, but the current stock is zero."
        elif stock_quantity < quantity_value:
            availability_status = "insufficient_stock"
            availability_label = "Insufficient stock"
            note = (
                f"Only {stock_quantity} unit(s) are available, which is below the prescribed quantity."
            )
            unit_price = inventory_entry.get("unit_price")
            matched_inventory_id = inventory_entry.get("id")
        else:
            unit_price = float(inventory_entry.get("unit_price") or 0)
            line_total = round(unit_price * quantity_value, 2)
            estimated_total += line_total
            included_items += 1
            matched_inventory_id = inventory_entry.get("id")

        if availability_status != "available":
            unavailable_items += 1

        estimate_items.append(
            {
                "id": item["id"],
                "inventory_id": matched_inventory_id,
                "medicine_name": medicine_name,
                "dosage": item.get("dosage"),
                "quantity": quantity_label,
                "quantity_value": quantity_value,
                "instructions": item.get("instructions"),
                "availability_status": availability_status,
                "availability_label": availability_label,
                "stock_quantity": stock_quantity,
                "unit_price": unit_price,
                "estimated_total": line_total,
                "note": note,
            }
        )

    return {
        "prescription": {
            "id": prescription["id"],
            "status": _title_status(prescription.get("status")),
            "created_at": prescription.get("created_at"),
            "doctor_name": doctor.get("display_name"),
        },
        "pharmacy": {
            "id": pharmacy_id,
            "name": pharmacy_organisation.get("name", f"Pharmacy #{pharmacy_id}"),
            "organisation_status": pharmacy_organisation.get("status"),
        },
        "summary": {
            "estimated_total": round(estimated_total, 2),
            "included_items": included_items,
            "excluded_items": len(estimate_items) - included_items,
            "unavailable_items": unavailable_items,
        },
        "items": estimate_items,
    }


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

    edge_answer, gemini_issue = _call_gemini_ai(payload.message, payload.history, snapshot)
    if edge_answer:
        # ── Attach disclaimer (Bihanga B-6.2.1) ──────────────────
        return build_safe_response(
            answer = edge_answer,
            source = "gemini_edge",
            role   = "patient"
        )

    fallback_answer = _fallback_assistant_answer(payload.message, snapshot)
    if gemini_issue:
        fallback_answer = (
            "Live AI answer is unavailable right now. "
            "I am answering from saved patient data only.\n\n"
            f"{fallback_answer}"
        )

    return build_safe_response(
        answer = fallback_answer,
        source = "patient_fallback",
        role   = "patient"
    )

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
