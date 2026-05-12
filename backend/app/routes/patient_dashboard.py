import json
import os
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from app.config.supabase import execute_with_retry, supabase, supabase_admin
from app.middleware.ai_anonymiser import anonymise_and_check
from app.middleware.file_validator import validate_upload_file
from app.middleware.role_checker import RoleChecker, build_user_context
from app.utils.helpers import validate_dhid, mask_nic, sanitize_search_query
from app.utils.gemini_client import call_gemini_assistant
from app.middleware.ai_disclaimer import build_safe_response

router = APIRouter(prefix="/patient/dashboard", tags=["patient-dashboard"])

COLOMBO_TZ = ZoneInfo("Asia/Colombo")

_ALLOWED_PATIENT_STATUS_UPDATES = {"cancelled"}
_TERMINAL_APPOINTMENT_STATUSES = {"completed", "cancelled"}


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
    preferred_name: Optional[str] = None
    address: Optional[str] = None
    medical_record_consent_default: Optional[bool] = None

    @field_validator("preferred_name")
    @classmethod
    def validate_preferred_name(cls, value: Optional[str]):
        if value is None:
            return value
        cleaned = value.strip()
        if len(cleaned) < 2:
            raise ValueError("Preferred name must be at least 2 characters")
        return cleaned

    @field_validator("address")
    @classmethod
    def validate_address(cls, value: Optional[str]):
        if value is None:
            return value
        cleaned = value.strip()
        if len(cleaned) < 5:
            raise ValueError("Address must be at least 5 characters")
        return cleaned

    @model_validator(mode="after")
    def validate_payload(self):
        if (
            self.preferred_name is None
            and self.address is None
            and self.medical_record_consent_default is None
        ):
            raise ValueError("Provide at least one profile field to update")
        return self


class PatientSelfRecordCreateRequest(BaseModel):
    title: Optional[str] = None
    notes: str
    health_snapshot: Optional["HealthSnapshotInput"] = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: Optional[str]):
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if len(cleaned) < 2:
            raise ValueError("Record title must be at least 2 characters")
        return cleaned

    @field_validator("notes")
    @classmethod
    def validate_notes(cls, value: str):
        cleaned = value.strip()
        if len(cleaned) < 10:
            raise ValueError("Medical record notes must be at least 10 characters")
        return cleaned


class HealthSnapshotInput(BaseModel):
    bmi: Optional[str] = None
    blood_sugar: Optional[str] = None
    cholesterol: Optional[str] = None
    blood_pressure: Optional[str] = None
    allergies: Optional[str] = None
    checked_at: Optional[datetime] = None

    @field_validator("bmi", "blood_sugar", "cholesterol", "blood_pressure", "allergies")
    @classmethod
    def validate_metric_text(cls, value: Optional[str]):
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if len(cleaned) > 160:
            raise ValueError("Metric value is too long")
        return cleaned

    @model_validator(mode="after")
    def validate_snapshot(self):
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


_APPOINTMENT_CONFIRM_PATTERN = re.compile(
    r"\bconfirm\s+booking\s+slot\s+(?P<slot_id>\d+)\b",
    re.IGNORECASE,
)
_MEDICINE_STRENGTH_PATTERN = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|kg|ml|l|iu|%|units?)\b",
    re.IGNORECASE,
)
_MEDICINE_FORM_TOKENS = {
    "tablet",
    "tablets",
    "capsule",
    "capsules",
    "syrup",
    "suspension",
    "solution",
    "cream",
    "ointment",
    "gel",
    "drops",
    "drop",
    "spray",
    "inhaler",
    "patch",
    "injection",
    "injectable",
    "ampoule",
    "vial",
}


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
            "legal_name": user_context.get("legal_name"),
            "preferred_name": user_context.get("preferred_name"),
            "address": user_context.get("address"),
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
            linked_user.get("pref_name")
            or linked_user.get("name")
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


def _release_slot_for_appointment(appointment: dict):
    doctor_id = appointment.get("doctor_id")
    start_time = appointment.get("start_time")
    end_time = appointment.get("end_time")

    if not doctor_id or not start_time or not end_time:
        return

    appointment_start = _parse_iso_datetime(start_time)
    appointment_end = _parse_iso_datetime(end_time)
    if not appointment_start or not appointment_end:
        return

    candidate_slots = execute_with_retry(
        lambda: (
            supabase_admin.table("availability_slots")
            .select("id, start_time, end_time, is_booked")
            .eq("doctor_id", doctor_id)
            .execute()
            .data
            or []
        ),
        default=[],
    )

    matching_slot_ids = [
        slot["id"]
        for slot in candidate_slots
        if slot.get("id")
        and _parse_iso_datetime(slot.get("start_time")) == appointment_start
        and _parse_iso_datetime(slot.get("end_time")) == appointment_end
    ]

    if not matching_slot_ids:
        matching_slot_ids = [
            slot["id"]
            for slot in candidate_slots
            if slot.get("id")
            and slot.get("is_booked")
            and (slot_start := _parse_iso_datetime(slot.get("start_time")))
            and (slot_end := _parse_iso_datetime(slot.get("end_time")))
            and slot_start < appointment_end
            and slot_end > appointment_start
        ]

    if not matching_slot_ids:
        return

    execute_with_retry(
        lambda: (
            supabase_admin.table("availability_slots")
            .update({"is_booked": False})
            .in_("id", matching_slot_ids)
            .execute()
        ),
        default=None,
    )


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


def _format_record(
    row,
    appointments_map,
    doctor_lookup,
    prescriptions_map,
    items_map,
    organisation_lookup,
    attachments_map=None,
):
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
        "attachments": [
            _format_record_attachment(item)
            for item in (attachments_map or {}).get(row["id"], [])
        ],
    }


def _list_patient_self_records(patient_id: int) -> list[dict]:
    try:
        return (
            execute_with_retry(
                lambda: (
                    supabase_admin.table("patient_self_records")
                    .select("*")
                    .eq("patient_id", patient_id)
                    .order("created_at", desc=True)
                    .execute()
                    .data
                    or []
                ),
                default=[],
            )
            or []
        )
    except Exception:
        return []


def _format_patient_self_record(row: dict, attachments=None):
    title = row.get("title") or "Self Added Record"
    return {
        "id": row["id"],
        "created_at": row.get("created_at"),
        "notes": row.get("notes"),
        "title": title,
        "source": "patient",
        "doctor": {
            "id": 0,
            "name": title,
            "specialization": "Patient entry",
        },
        "appointment": {
            "id": None,
            "start_time": None,
            "end_time": None,
            "status": None,
        },
        "organisation": {
            "id": None,
            "name": None,
        },
        "prescriptions": [],
        "attachments": [_format_record_attachment(item) for item in (attachments or [])],
    }


def _safe_attachment_filename(filename: Optional[str]) -> str:
    original = filename or "attachment"
    stem, dot, ext = original.rpartition(".")
    base = stem if dot else original
    suffix = f".{ext.lower()}" if dot else ""
    safe_base = re.sub(r"[^a-zA-Z0-9_-]+", "_", base).strip("_") or "attachment"
    return f"{safe_base[:80]}{suffix}"


def _format_record_attachment(row: dict):
    return {
        "id": row["id"],
        "file_name": row.get("file_name"),
        "file_url": row.get("file_url"),
        "content_type": row.get("content_type"),
        "file_size_bytes": row.get("file_size_bytes"),
        "created_at": row.get("created_at"),
    }


def _list_record_attachments(patient_id: int) -> list[dict]:
    try:
        return (
            execute_with_retry(
                lambda: (
                    supabase_admin.table("medical_record_attachments")
                    .select("*")
                    .eq("patient_id", patient_id)
                    .order("created_at", desc=True)
                    .execute()
                    .data
                    or []
                ),
                default=[],
            )
            or []
        )
    except Exception:
        return []


async def _store_record_attachments(
    *,
    patient_id: int,
    source_role: str,
    source_user_id: Optional[str],
    files: Optional[list[UploadFile]],
    encounter_id: Optional[int] = None,
    patient_self_record_id: Optional[int] = None,
):
    if not files:
        return []

    stored_rows = []
    for upload in files:
        if not upload or not (upload.filename or "").strip():
            continue

        contents = await validate_upload_file(upload)
        safe_name = _safe_attachment_filename(upload.filename)
        storage_path = (
            f"medical-records/patient-{patient_id}/{uuid.uuid4().hex}_{safe_name}"
        )

        try:
            supabase_admin.storage.from_("records").upload(
                path=storage_path,
                file=contents,
                file_options={"content-type": upload.content_type or "application/octet-stream"},
            )
            file_url = supabase_admin.storage.from_("records").get_public_url(storage_path)
            inserted = (
                supabase_admin.table("medical_record_attachments")
                .insert(
                    {
                        "patient_id": patient_id,
                        "encounter_id": encounter_id,
                        "patient_self_record_id": patient_self_record_id,
                        "source_role": source_role,
                        "source_user_id": source_user_id,
                        "file_name": upload.filename,
                        "file_url": file_url,
                        "content_type": upload.content_type or "application/octet-stream",
                        "file_size_bytes": len(contents),
                    }
                )
                .execute()
                .data
                or []
            )
            if inserted:
                stored_rows.append(inserted[0])
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Medical record attachment upload failed.") from exc

    return stored_rows


def _list_patient_health_snapshots(patient_id: int) -> list[dict]:
    try:
        return (
            execute_with_retry(
                lambda: (
                    supabase_admin.table("patient_health_snapshots")
                    .select("*")
                    .eq("patient_id", patient_id)
                    .order("checked_at", desc=True)
                    .execute()
                    .data
                    or []
                ),
                default=[],
            )
            or []
        )
    except Exception:
        return []


def _snapshot_has_values(snapshot: Optional[HealthSnapshotInput]) -> bool:
    if not snapshot:
        return False
    return any(
        [
            snapshot.bmi,
            snapshot.blood_sugar,
            snapshot.cholesterol,
            snapshot.blood_pressure,
            snapshot.allergies,
        ]
    )


def _format_health_snapshot(row: Optional[dict]):
    if not row:
        return None
    return {
        "id": row.get("id"),
        "bmi": row.get("bmi"),
        "blood_sugar": row.get("blood_sugar"),
        "cholesterol": row.get("cholesterol"),
        "blood_pressure": row.get("blood_pressure"),
        "allergies": row.get("allergies"),
        "checked_at": row.get("checked_at") or row.get("created_at"),
        "source_role": row.get("source_role"),
    }


def _create_health_snapshot(
    *,
    patient_id: int,
    source_role: str,
    source_user_id: Optional[str],
    snapshot: Optional[HealthSnapshotInput],
    encounter_id: Optional[int] = None,
    patient_self_record_id: Optional[int] = None,
):
    if not _snapshot_has_values(snapshot):
        return None

    rows = (
        supabase_admin.table("patient_health_snapshots")
        .insert(
            {
                "patient_id": patient_id,
                "source_role": source_role,
                "source_user_id": source_user_id,
                "encounter_id": encounter_id,
                "patient_self_record_id": patient_self_record_id,
                "bmi": snapshot.bmi,
                "blood_sugar": snapshot.blood_sugar,
                "cholesterol": snapshot.cholesterol,
                "blood_pressure": snapshot.blood_pressure,
                "allergies": snapshot.allergies,
                "checked_at": (
                    snapshot.checked_at.astimezone().isoformat()
                    if snapshot.checked_at
                    else datetime.now().astimezone().isoformat()
                ),
            }
        )
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            parsed = parsed.replace(tzinfo=COLOMBO_TZ)
        return parsed
    except ValueError:
        return None


def _assistant_datetime_label(value: Optional[str]) -> str:
    parsed = _parse_iso_datetime(value)
    if not parsed:
        return "an unscheduled time"
    return parsed.astimezone(COLOMBO_TZ).strftime("%b %d, %Y at %I:%M %p")


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


def _clean_free_text(value: Optional[str]) -> str:
    return " ".join((value or "").replace("\xa0", " ").split())


def _message_requests_booking(message: str) -> bool:
    normalized = message.lower()
    booking_verbs = ("book", "booking", "schedule", "reserve")
    booking_objects = ("appointment", "slot", "doctor", "clinic", "hospital")
    return any(token in normalized for token in booking_verbs) and any(
        token in normalized for token in booking_objects
    )


def _extract_confirmation_slot_id(message: str) -> Optional[int]:
    match = _APPOINTMENT_CONFIRM_PATTERN.search(message)
    if not match:
        return None
    try:
        return int(match.group("slot_id"))
    except (TypeError, ValueError):
        return None


def _extract_requested_date(message: str) -> Optional[str]:
    normalized = message.lower()
    today_local = datetime.now(COLOMBO_TZ).date()

    if "tomorrow" in normalized:
        return (today_local + timedelta(days=1)).isoformat()
    if "today" in normalized:
        return today_local.isoformat()

    iso_match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", message)
    if iso_match:
        return iso_match.group(1)

    slash_match = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", message)
    if slash_match:
        day_value, month_value, year_value = slash_match.groups()
        try:
            parsed = date(int(year_value), int(month_value), int(day_value))
            return parsed.isoformat()
        except ValueError:
            return None

    return None


def _assistant_slot_matches_message(slot: dict, normalized_message: str) -> tuple[int, bool]:
    score = 0
    matched_any_named_filter = False

    requested_date = _extract_requested_date(normalized_message)
    slot_date = None
    if slot.get("start_time"):
        parsed = _parse_iso_datetime(slot.get("start_time"))
        slot_date = parsed.astimezone(COLOMBO_TZ).date().isoformat() if parsed else None
    if requested_date:
        if slot_date != requested_date:
            return -1, True
        score += 50
        matched_any_named_filter = True

    for field, weight in (
        ("doctor_name", 30),
        ("specialization", 20),
        ("organisation_name", 15),
    ):
        value = _clean_free_text(slot.get(field)).lower()
        if value and value in normalized_message:
            score += weight
            matched_any_named_filter = True

    return score, matched_any_named_filter


def _pick_booking_slot(snapshot: dict, message: str) -> tuple[Optional[dict], list[dict]]:
    normalized = message.lower()
    slots = snapshot.get("bookable_slots", [])
    if not slots:
        return None, []

    scored: list[tuple[int, dict]] = []
    saw_named_filter = False
    for slot in slots:
        score, matched_named_filter = _assistant_slot_matches_message(slot, normalized)
        if score < 0:
            continue
        saw_named_filter = saw_named_filter or matched_named_filter
        scored.append((score, slot))

    if not scored:
        return None, []

    scored.sort(
        key=lambda item: (
            -item[0],
            item[1].get("start_time") or "",
            item[1].get("doctor_name") or "",
        )
    )
    ranked_slots = [slot for _, slot in scored]
    if saw_named_filter:
        filtered = [slot for score, slot in scored if score > 0]
        if filtered:
            return filtered[0], filtered
    return ranked_slots[0], ranked_slots


def _medicine_profile(name: Optional[str], unit: Optional[str]) -> dict[str, str]:
    name_text = _clean_free_text(name).lower()
    unit_text = _clean_free_text(unit).lower()
    combined = f"{name_text} {unit_text}".strip()

    strength_match = _MEDICINE_STRENGTH_PATTERN.search(combined)
    strength = strength_match.group(0).lower() if strength_match else ""

    form = ""
    for token in _MEDICINE_FORM_TOKENS:
        if re.search(rf"\b{re.escape(token)}\b", combined):
            form = token.rstrip("s")
            break

    ingredient_source = combined
    if strength:
        ingredient_source = ingredient_source.replace(strength, " ")
    for token in _MEDICINE_FORM_TOKENS:
        ingredient_source = re.sub(
            rf"\b{re.escape(token)}\b", " ", ingredient_source, flags=re.IGNORECASE
        )
    ingredient_key = re.sub(r"[^a-z0-9]+", " ", ingredient_source).strip()
    ingredient_key = re.sub(r"\s+", " ", ingredient_key)

    return {
        "ingredient_key": ingredient_key,
        "strength": strength,
        "form": form,
    }


def _message_requests_generic_equivalent(message: str) -> bool:
    normalized = message.lower()
    generic_tokens = ("generic", "equivalent", "same ingredient", "alternative")
    medicine_tokens = ("medicine", "medicines", "drug", "tablet", "capsule", "prescription")
    return any(token in normalized for token in generic_tokens) and any(
        token in normalized for token in medicine_tokens
    )


def _message_requests_therapeutic_alternative(message: str) -> bool:
    normalized = message.lower()
    return "therapeutic alternative" in normalized or (
        "therapeutic" in normalized and "alternative" in normalized
    )


def _resolve_medicine_from_message(message: str, snapshot: dict) -> Optional[dict]:
    normalized = _normalize_medicine_key(message)
    latest_items = (
        snapshot.get("latest_prescription", {}).get("items", [])
        if snapshot.get("latest_prescription")
        else []
    )
    ranked: list[tuple[int, dict]] = []
    for item in latest_items:
        candidate_name = _clean_free_text(item.get("medicine_name"))
        candidate_key = _normalize_medicine_key(candidate_name)
        if not candidate_key:
            continue
        if candidate_key in normalized or normalized in candidate_key:
            ranked.append((len(candidate_key), item))

    if ranked:
        ranked.sort(key=lambda item: -item[0])
        return ranked[0][1]

    if len(latest_items) == 1:
        return latest_items[0]

    return None


def _medicine_catalog_entry(medicine_id: Optional[int], medicine_name: Optional[str]) -> Optional[dict]:
    if medicine_id:
        rows = execute_with_retry(
            lambda: (
                supabase_admin.table("medicines")
                .select("id, name, unit, retail_price, wholesale_price")
                .eq("id", medicine_id)
                .limit(1)
                .execute()
                .data
                or []
            ),
            default=[],
        )
        if rows:
            return rows[0]

    cleaned_name = _clean_free_text(medicine_name)
    if not cleaned_name:
        return None

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("medicines")
            .select("id, name, unit, retail_price, wholesale_price")
            .ilike("name", cleaned_name)
            .limit(5)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    normalized_target = _normalize_medicine_key(cleaned_name)
    for row in rows:
        if _normalize_medicine_key(row.get("name")) == normalized_target:
            return row
    return rows[0] if rows else None


def _generic_equivalent_candidates(medicine: dict) -> list[dict]:
    profile = _medicine_profile(medicine.get("name"), medicine.get("unit"))
    if not profile["ingredient_key"] or not profile["strength"] or not profile["form"]:
        return []

    search_token = profile["ingredient_key"].split(" ", 1)[0]
    candidate_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("medicines")
            .select("id, name, unit, retail_price, wholesale_price")
            .ilike("name", f"%{search_token}%")
            .limit(80)
            .execute()
            .data
            or []
        ),
        default=[],
    )

    equivalents = []
    target_key = _normalize_medicine_key(medicine.get("name"))
    target_id = medicine.get("id")
    for row in candidate_rows:
        if row.get("id") == target_id:
            continue
        if _normalize_medicine_key(row.get("name")) == target_key:
            continue
        candidate_profile = _medicine_profile(row.get("name"), row.get("unit"))
        if candidate_profile != profile:
            continue
        equivalents.append(row)

    equivalents.sort(
        key=lambda row: (
            float(row.get("retail_price") or row.get("wholesale_price") or 0),
            _clean_free_text(row.get("name")).lower(),
        )
    )
    return equivalents[:5]


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


def _patient_default_consent_state(patient_id: int) -> dict[str, object]:
    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("audit_logs")
            .select("action, timestamp")
            .eq("entity", "patient_consent_default")
            .eq("entity_id", patient_id)
            .order("timestamp", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    latest = rows[0] if rows else None
    if not latest:
        return {"granted": True, "last_updated": None, "status": "Default On"}

    granted = latest.get("action") != "CONSENT_DEFAULT_REVOKED"
    return {
        "granted": granted,
        "last_updated": latest.get("timestamp"),
        "status": "Default On" if granted else "Default Off",
    }


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

    now = datetime.now(COLOMBO_TZ)
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
            "medicine_id": item.get("medicine_id"),
            "medicine_name": item.get("medicine_name"),
            "dosage": item.get("dosage"),
            "unit": item.get("unit"),
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
    bookable_slots = []
    seen_doctors = set()
    for slot in availability_rows:
        doctor_id = slot.get("doctor_id")
        if not doctor_id:
            continue

        start_time = _parse_iso_datetime(slot.get("start_time"))
        end_time = _parse_iso_datetime(slot.get("end_time"))
        if not start_time or not end_time or end_time < now:
            continue

        doctor = booking_doctor_lookup.get(doctor_id, {})
        resolved_organisation_id = _resolve_slot_organisation_id(
            slot,
            approved_affiliations_by_doctor,
            booking_hospital_lookup,
        )
        organisation = booking_org_lookup.get(resolved_organisation_id, {})
        slot_summary = {
            "slot_id": slot.get("id"),
            "doctor_id": doctor_id,
            "doctor_name": doctor.get("display_name", f"Doctor #{doctor_id}"),
            "specialization": doctor.get("specialization"),
            "organisation_id": resolved_organisation_id,
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
        bookable_slots.append(slot_summary)

        if doctor_id in seen_doctors:
            continue

        seen_doctors.add(doctor_id)
        available_doctors.append(
            {
                **slot_summary,
            }
        )

    return {
        "user": {
            "id": user["id"],
            "name": user.get("name"),
            "email": user.get("email"),
            "address": user.get("address"),
        },
        "patient": {
            "id": patient["id"],
            "dhid": patient.get("dhid"),
            "created_at": patient.get("created_at"),
        },
        "assistant_runtime": {
            "timezone": "Asia/Colombo",
            "current_date": now.date().isoformat(),
            "current_datetime": now.isoformat(),
        },
        "stats": {
            "appointments": len(appointments),
            "encounters": len(encounters),
            "prescriptions": len(prescriptions),
        },
        "booking_options": booking_options[:12],
        "available_doctors": available_doctors[:8],
        "bookable_slots": bookable_slots[:20],
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
                                (
                                    f"{item.get('dosage')} {item.get('unit')}"
                                    if item.get("dosage") and item.get("unit")
                                    else item.get("dosage") or "As directed"
                                ),
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


def _book_slot_for_patient(context: dict, slot_id: int):
    patient = context["patient"]
    default_consent = _patient_default_consent_state(patient["id"])

    slot = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("id", slot_id)
        .eq("is_booked", False)
        .single()
        .execute()
        .data
    )

    if not slot:
        raise HTTPException(status_code=400, detail="Slot not available")
    
    now = datetime.now(timezone.utc)

    # Parse the slot start time (ensure it's UTC-aware for comparison)
    # Most Supabase SDKs return strings, so we parse it
    from dateutil import parser
    slot_start_dt = parser.isoparse(slot["start_time"])

    if slot_start_dt.tzinfo is None:
        slot_start_dt = slot_start_dt.replace(tzinfo=timezone.utc)

    if slot_start_dt < now:
        raise HTTPException(
            status_code=400, 
            detail="Cannot book a slot that has already passed."
        )

    slot_start = slot["start_time"]
    slot_end = slot["end_time"]

    patient_conflicts = (
        supabase_admin.table("appointments")
        .select("id, start_time, end_time, status")
        .eq("patient_id", patient["id"])
        .not_.in_("status", ["cancelled", "completed"])
        .lt("start_time", slot_end)
        .gt("end_time", slot_start)
        .execute()
        .data
        or []
    )

    if patient_conflicts:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "Double booking detected",
                "message": "You already have an appointment during this time slot. Please cancel it before booking a new one.",
                "conflict_appointment_id": patient_conflicts[0]["id"],
            },
        )

    doctor_conflicts = (
        supabase_admin.table("appointments")
        .select("id, start_time, end_time, status")
        .eq("doctor_id", slot["doctor_id"])
        .not_.in_("status", ["cancelled", "completed"])
        .lt("start_time", slot_end)
        .gt("end_time", slot_start)
        .execute()
        .data
        or []
    )

    if doctor_conflicts:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "Doctor unavailable",
                "message": "This doctor already has an appointment during this time. Please choose a different time slot.",
            },
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

    created = (
        supabase_admin.table("appointments")
        .insert(
            {
                "patient_id": patient["id"],
                "doctor_id": slot["doctor_id"],
                "organisation_id": resolved_organisation_id,
                "start_time": slot["start_time"],
                "end_time": slot["end_time"],
                "status": "pending",
            }
        )
        .execute()
    )

    if not created.data:
        raise HTTPException(status_code=500, detail="Failed to create appointment")

    appointment = created.data[0]

    supabase_admin.table("availability_slots").update({"is_booked": True}).eq("id", slot_id).execute()

    _log_audit_action(context["user_id"], "APPOINTMENT_CREATED", "appointments", appointment["id"])
    _log_audit_action(
        context["user_id"],
        "CONSENT_GRANTED" if default_consent["granted"] else "CONSENT_REVOKED",
        "appointment_consent",
        appointment["id"],
    )

    doctor_lookup = _doctor_map({appointment["doctor_id"]})
    organisation_lookup = _organisation_map({appointment["organisation_id"]})

    return _format_appointment_with_consent(
        appointment,
        doctor_lookup,
        organisation_lookup,
        {
            appointment["id"]: {
                "granted": bool(default_consent["granted"]),
                "last_updated": datetime.now().astimezone().isoformat(),
            }
        },
    )


def _build_booking_confirmation_answer(slot: dict) -> str:
    return (
        f"I found a live slot with {slot.get('doctor_name')} at {slot.get('organisation_name')} on "
        f"{_assistant_datetime_label(slot.get('start_time'))}. "
        f"Reply exactly `Confirm booking slot {slot.get('slot_id')}` if you want me to book it. "
        "I will not place the booking until you send that confirmation."
    )


def _build_generic_equivalent_answer(message: str, snapshot: dict) -> Optional[str]:
    if _message_requests_therapeutic_alternative(message):
        return (
            "I cannot suggest therapeutic alternatives here. "
            "I only surface exact generic-equivalent options when the ingredient, strength, and dosage form all match a saved medicine."
        )

    if not _message_requests_generic_equivalent(message):
        return None

    target = _resolve_medicine_from_message(message, snapshot)
    if not target:
        return (
            "I could not safely identify which medicine you mean from your saved prescription context. "
            "Mention the exact medicine name, and I will only check exact generic-equivalent matches."
        )

    medicine = _medicine_catalog_entry(target.get("medicine_id"), target.get("medicine_name"))
    if not medicine:
        return (
            f"I could not map {target.get('medicine_name') or 'that medicine'} to the saved medicine registry, "
            "so I am not going to guess a therapeutic substitute."
        )

    profile = _medicine_profile(medicine.get("name"), medicine.get("unit"))
    if not profile["ingredient_key"] or not profile["strength"] or not profile["form"]:
        return (
            f"I found {medicine.get('name')}, but I cannot verify a full ingredient/strength/form profile from the saved registry data. "
            "Because of that, I will not suggest a therapeutic alternative."
        )

    equivalents = _generic_equivalent_candidates(medicine)
    if not equivalents:
        return (
            f"I found {medicine.get('name')}, but I do not see another saved medicine with the same ingredient, strength, and dosage form. "
            "I will not suggest a therapeutic alternative instead."
        )

    lines = []
    for row in equivalents[:3]:
        price = row.get("retail_price") or row.get("wholesale_price")
        price_label = f"LKR {float(price):,.2f}" if price not in (None, "") else "price not listed"
        lines.append(f"{row.get('name')} ({row.get('unit') or 'unit not listed'}) - {price_label}")

    return (
        f"Exact generic-equivalent matches for {medicine.get('name')} are: "
        + "; ".join(lines)
        + ". I filtered these to the same ingredient, strength, and dosage form only. "
        "I am intentionally not suggesting therapeutic alternatives."
    )


@router.get("/overview", dependencies=[Depends(RoleChecker(["patient"]))])
def get_overview(authorization: Optional[str] = Header(None)):
    context = _require_patient_context(authorization)
    patient = context["patient"]
    default_consent = _patient_default_consent_state(patient["id"])

    appointments = execute_with_retry(
        lambda: (
            supabase_admin.table("appointments")
            .select("*")
            .eq("patient_id", patient["id"])
            .order("start_time")
            .limit(50)
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
            .limit(20)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    self_records = _list_patient_self_records(patient["id"])
    health_snapshots = _list_patient_health_snapshots(patient["id"])
    prescriptions = execute_with_retry(
        lambda: (
            supabase_admin.table("prescriptions")
            .select("*")
            .eq("patient_id", patient["id"])
            .order("created_at", desc=True)
            .limit(20)
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
    now = datetime.now(COLOMBO_TZ)
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
    recent_self_record = self_records[0] if self_records else None
    latest_health_snapshot = health_snapshots[0] if health_snapshots else None
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

    recent_record_created_at = _parse_iso_datetime(recent_encounter.get("created_at")) if recent_encounter else None
    recent_self_record_created_at = (
        _parse_iso_datetime(recent_self_record.get("created_at")) if recent_self_record else None
    )
    use_self_record = bool(
        recent_self_record
        and (
            recent_record_created_at is None
            or (
                recent_self_record_created_at is not None
                and recent_self_record_created_at >= recent_record_created_at
            )
        )
    )

    return {
        "user": {
            "id": context["user"]["id"],
            "email": context["user"]["email"],
            "name": context["user"].get("name"),
            "legal_name": context["user"].get("legal_name"),
            "preferred_name": context["user"].get("preferred_name"),
            "address": context["user"].get("address"),
        },
        "patient": {
            "id": patient["id"],
            "dhid": patient["dhid"],
            "created_at": patient.get("created_at"),
            "medical_record_consent_default": bool(default_consent["granted"]),
            "medical_record_consent_last_updated": default_consent["last_updated"],
            "health_snapshot": _format_health_snapshot(latest_health_snapshot),
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
            "medical_records": len(encounters) + len(self_records),
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
        "recent_record": (
            {
                "id": recent_self_record["id"],
                "created_at": recent_self_record.get("created_at"),
                "notes": recent_self_record.get("notes"),
                "appointment": None,
            }
            if use_self_record and recent_self_record
            else {
                "id": recent_encounter["id"],
                "created_at": recent_encounter.get("created_at"),
                "notes": recent_encounter.get("notes"),
                "appointment": recent_appointment_map.get(recent_encounter.get("appointment_id")),
            }
            if recent_encounter
            else None
        ),
    }


@router.get("/appointments", dependencies=[Depends(RoleChecker(["patient"]))])
def list_appointments(authorization: Optional[str] = Header(None)):
    context = _require_patient_context(authorization)
    patient = context["patient"]

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("appointments")
            .select("*")
            .eq("patient_id", patient["id"])
            .limit(50)
            .execute()
            .data
            or []
        ),
        default=[],
    )

    # Custom status priority
    status_priority = {
        "pending": 0,
        "missed": 1,
        "completed": 2,
        "cancelled": 3,
    }

    rows.sort(key=lambda row: status_priority.get(row["status"], 99))

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

@router.patch("/profile", dependencies=[Depends(RoleChecker(["patient"]))])
def update_profile(
    payload: ProfileUpdateRequest,
    authorization: Optional[str] = Header(None),
):
    context = _require_patient_context(authorization)

    updated = []
    resolved_name = context["user"].get("name")
    resolved_address = context["user"].get("address")
    user_updates = {}

    if payload.preferred_name is not None:
        user_updates["pref_name"] = payload.preferred_name
        resolved_name = payload.preferred_name

    if payload.address is not None:
        user_updates["address"] = payload.address
        resolved_address = payload.address

    if user_updates:
        updated = (
            supabase_admin.table("users")
            .update(user_updates)
            .eq("id", context["user_id"])
            .execute()
            .data
            or []
        )
        _log_audit_action(context["user_id"], "PROFILE_UPDATED", "users", context["patient"]["id"])

    if payload.medical_record_consent_default is not None:
        _log_audit_action(
            context["user_id"],
            "CONSENT_DEFAULT_GRANTED" if payload.medical_record_consent_default else "CONSENT_DEFAULT_REVOKED",
            "patient_consent_default",
            context["patient"]["id"],
        )

    row = updated[0] if updated else {**context["user"], "name": resolved_name}
    return {
        "id": row["id"],
        "email": row["email"],
        "name": resolved_name,
        "legal_name": row.get("name"),
        "preferred_name": row.get("pref_name") or resolved_name,
        "address": row.get("address", resolved_address),
        "role": row.get("role"),
        "medical_record_consent_default": (
            payload.medical_record_consent_default
            if payload.medical_record_consent_default is not None
            else _patient_default_consent_state(context["patient"]["id"])["granted"]
        ),
    }


@router.get("/booking-options", dependencies=[Depends(RoleChecker(["patient"]))])
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

@router.get("/available-slots", dependencies=[Depends(RoleChecker(["patient"]))])
def get_available_slots(
    doctor_id: int,
    authorization: Optional[str] = Header(None)
):
    _require_patient_context(authorization)

    now_iso = datetime.now(timezone.utc).isoformat()

    raw_slots = execute_with_retry(
        lambda: (
            supabase_admin.table("availability_slots")
            .select("*")
            .eq("doctor_id", doctor_id)
            .eq("is_booked", False)
            .gt("start_time", now_iso)
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


@router.post("/appointments", dependencies=[Depends(RoleChecker(["patient"]))])
def create_appointment(
    payload: AppointmentCreateRequest,
    authorization: Optional[str] = Header(None)
):
    context = _require_patient_context(authorization)
    return _book_slot_for_patient(context, payload.slot_id)


@router.patch("/appointments/{appointment_id}", dependencies=[Depends(RoleChecker(["patient"]))])
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

    current_status = rows[0]["status"]

    update_data = {}
    if payload.start_time is not None:
        update_data["start_time"] = payload.start_time.isoformat()
    if payload.end_time is not None:
        update_data["end_time"] = payload.end_time.isoformat()
    if payload.status is not None:
        if payload.status not in _ALLOWED_PATIENT_STATUS_UPDATES:
            raise HTTPException(
                status_code=403,
                detail="Patients are not allowed to set this status"
            )
        if current_status in _TERMINAL_APPOINTMENT_STATUSES:
            raise HTTPException(
                status_code=400,
                detail="Cannot modify a completed or already cancelled appointment"
            )
        update_data["status"] = payload.status

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

    if update_data.get("status") == "cancelled":
        _release_slot_for_appointment(row)

    _log_audit_action(context["user_id"], "APPOINTMENT_UPDATED", "appointments", appointment_id)

    doctor_lookup = _doctor_map({row["doctor_id"]})
    organisation_lookup = _organisation_map({row["organisation_id"]})
    return _format_appointment(row, doctor_lookup, organisation_lookup)

@router.post("/appointments/{appointment_id}/consent", dependencies=[Depends(RoleChecker(["patient"]))])
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


@router.get("/records", dependencies=[Depends(RoleChecker(["patient"]))])
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

    snapshot_rows = _list_patient_health_snapshots(patient["id"])
    attachment_rows = _list_record_attachments(patient["id"])
    snapshot_by_encounter_id = {
        row.get("encounter_id"): row for row in snapshot_rows if row.get("encounter_id")
    }
    snapshot_by_self_record_id = {
        row.get("patient_self_record_id"): row
        for row in snapshot_rows
        if row.get("patient_self_record_id")
    }
    attachments_by_encounter_id = {}
    attachments_by_self_record_id = {}
    for row in attachment_rows:
        if row.get("encounter_id"):
            attachments_by_encounter_id.setdefault(row["encounter_id"], []).append(row)
        if row.get("patient_self_record_id"):
            attachments_by_self_record_id.setdefault(row["patient_self_record_id"], []).append(row)

    encounter_records = [
        {
            **_format_record(
                row,
                appointments_map,
                doctor_lookup,
                prescriptions_map,
                items_map,
                organisation_lookup,
                attachments_by_encounter_id,
            ),
            "source": "doctor",
            "health_snapshot": _format_health_snapshot(snapshot_by_encounter_id.get(row["id"])),
        }
        for row in encounters
    ]
    self_records = [
        {
            **_format_patient_self_record(row, attachments_by_self_record_id.get(row["id"], [])),
            "health_snapshot": _format_health_snapshot(snapshot_by_self_record_id.get(row["id"])),
        }
        for row in _list_patient_self_records(patient["id"])
    ]
    merged_records = encounter_records + self_records
    merged_records.sort(
        key=lambda row: _parse_iso_datetime(row.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )

    return {
        "items": merged_records
    }


@router.post("/records", dependencies=[Depends(RoleChecker(["patient"]))])
async def create_patient_self_record(
    payload: str = Form(...),
    files: Optional[list[UploadFile]] = File(None),
    authorization: Optional[str] = Header(None),
):
    context = _require_patient_context(authorization)
    patient = context["patient"]
    try:
        parsed_payload = PatientSelfRecordCreateRequest.model_validate_json(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    try:
        created = (
            supabase_admin.table("patient_self_records")
            .insert(
                {
                    "patient_id": patient["id"],
                    "title": parsed_payload.title,
                    "notes": parsed_payload.notes,
                }
            )
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Patient self-record storage is not ready yet. Run the latest database migration first.",
        ) from exc

    rows = created.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to save patient medical record")

    snapshot_row = _create_health_snapshot(
        patient_id=patient["id"],
        source_role="patient",
        source_user_id=context["user_id"],
        snapshot=parsed_payload.health_snapshot,
        patient_self_record_id=rows[0]["id"],
    )
    attachment_rows = await _store_record_attachments(
        patient_id=patient["id"],
        source_role="patient",
        source_user_id=context["user_id"],
        files=files,
        patient_self_record_id=rows[0]["id"],
    )

    _log_audit_action(context["user_id"], "PATIENT_SELF_RECORD_CREATED", "patient_self_records", rows[0]["id"])
    return {
        **_format_patient_self_record(rows[0], attachment_rows),
        "health_snapshot": _format_health_snapshot(snapshot_row),
    }


@router.get("/pharmacy", dependencies=[Depends(RoleChecker(["patient"]))])
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


@router.get("/pharmacies", dependencies=[Depends(RoleChecker(["patient"]))])
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


@router.get("/pharmacy/estimate", dependencies=[Depends(RoleChecker(["patient"]))])
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
                "unit": item.get("unit"),
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


@router.get("/dispensing", dependencies=[Depends(RoleChecker(["patient"]))])
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
                "unit": linked_item.get("unit"),
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


@router.post("/assistant/respond", dependencies=[Depends(RoleChecker(["patient"]))])
def assistant_respond(
    payload: AssistantRequest, authorization: Optional[str] = Header(None)
):
    context = _require_patient_context(authorization)
    snapshot = _build_assistant_snapshot(context["patient"], context["user"])

    confirmed_slot_id = _extract_confirmation_slot_id(payload.message)
    if confirmed_slot_id is not None:
        try:
            appointment = _book_slot_for_patient(context, confirmed_slot_id)
            answer = (
                f"Confirmed. I booked your appointment with {appointment['doctor']['name']} at "
                f"{appointment['organisation']['name']} on {_assistant_datetime_label(appointment.get('start_time'))}. "
                "Check the Appointments section if you want to review or cancel it."
            )
        except HTTPException as exc:
            detail = exc.detail
            if isinstance(detail, dict):
                detail = detail.get("message") or detail.get("error") or "Booking could not be completed."
            answer = f"I could not complete that booking. {detail}"
        return build_safe_response(
            answer=answer,
            source="patient_fallback",
            role="patient",
        )

    generic_answer = _build_generic_equivalent_answer(payload.message, snapshot)
    if generic_answer:
        return build_safe_response(
            answer=generic_answer,
            source="patient_fallback",
            role="patient",
        )

    if _message_requests_booking(payload.message):
        candidate_slot, candidate_slots = _pick_booking_slot(snapshot, payload.message)
        if candidate_slot:
            answer = _build_booking_confirmation_answer(candidate_slot)
            if len(candidate_slots) > 1:
                runner_up = candidate_slots[1]
                answer += (
                    f" Backup option: {runner_up.get('doctor_name')} at {runner_up.get('organisation_name')} on "
                    f"{_assistant_datetime_label(runner_up.get('start_time'))}."
                )
        else:
            answer = (
                "I could not find a matching live slot from the current saved availability. "
                "Try mentioning a doctor, hospital, or a date like 2026-05-10, and I will narrow it down."
            )
        return build_safe_response(
            answer=answer,
            source="patient_fallback",
            role="patient",
        )

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
