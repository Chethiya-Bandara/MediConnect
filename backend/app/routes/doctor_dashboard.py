import json
import os
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
import uuid
import re

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile, Depends, Query
from app.middleware.file_validator import validate_upload_file, sanitize_filename
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from app.config.supabase import execute_with_retry, supabase, supabase_admin
from app.middleware.consent_guard import check_consent, auto_revoke_consent
from app.middleware.ai_anonymiser import anonymise_and_check
from app.middleware.ai_disclaimer import build_safe_response
from app.utils.gemini_client import call_gemini_assistant

router = APIRouter(prefix="/doctor/dashboard", tags=["doctor-dashboard"])

SRI_LANKA_TZ = timezone(timedelta(hours=5, minutes=30))


class ProfileUpdateRequest(BaseModel):
    preferred_name: str
    address: str
    specialization: str
    slmc_number: str

    @field_validator("preferred_name", "specialization", "slmc_number")
    @classmethod
    def validate_required_text(cls, value: str):
        cleaned = value.strip()
        if len(cleaned) < 2:
            raise ValueError("Field must be at least 2 characters")
        return cleaned

    @field_validator("address")
    @classmethod
    def validate_address(cls, value: str):
        cleaned = value.strip()
        if len(cleaned) < 5:
            raise ValueError("Address must be at least 5 characters")
        return cleaned


class EncounterPrescriptionItemRequest(BaseModel):
    medicine_id: Optional[int] = None
    medicine_name: str
    dosage: str = ""
    duration: str = ""

    @field_validator("medicine_id")
    @classmethod
    def validate_medicine_id(cls, value: Optional[int]):
        if value is None:
            return None
        if value <= 0:
            raise ValueError("Medicine ID must be a positive integer")
        return value

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
    health_snapshot: Optional["HealthSnapshotInput"] = None
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
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    slot_date: Optional[str] = None
    hospital_id: Optional[int] = None
    slot_duration_minutes: int = Field(default=15, ge=5, le=240)

    @model_validator(mode="after")
    def validate_times(self):
        if self.slot_date:
            if not self.start_time or not self.end_time:
                raise ValueError("Start and end time are required")
            try:
                start = _parse_local_slot_datetime(self.slot_date, self.start_time)
                end = _parse_local_slot_datetime(self.slot_date, self.end_time)
            except ValueError as exc:
                raise ValueError("Invalid date or time format") from exc
        else:
            if not self.start_time or not self.end_time:
                raise ValueError("Start and end time are required")
            start = _parse_iso_datetime(self.start_time)
            end = _parse_iso_datetime(self.end_time)

        if not start or not end:
            raise ValueError("Invalid datetime format")

        if end <= start:
            raise ValueError("End time must be after start time")

        return self


class AvailabilitySlotUpdateRequest(BaseModel):
    start_time: str
    end_time: str

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_text(cls, value: str):
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Field cannot be empty")
        return cleaned


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

class AffiliationRequest(BaseModel):
    hospital_id: int


class AffiliationRevokeRequest(BaseModel):
    affiliation_id: int


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
        db_user_rows = execute_with_retry(
            lambda: (
                supabase_admin.table("users")
                .select("*")
                .eq("id", user_id)
                .execute()
                .data
            ),
            default=[],
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="User profile could not be loaded right now. Please retry.",
        ) from exc

    db_user = db_user_rows[0] if db_user_rows else None

    if not db_user or (db_user.get("role") or "").lower() != "doctor":
        raise HTTPException(status_code=403, detail="Doctor access required")

    try:
        doctor_rows = execute_with_retry(
            lambda: (
                supabase_admin.table("doctors")
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
            detail="Doctor profile could not be loaded right now. Please retry.",
        ) from exc

    doctor = doctor_rows[0] if doctor_rows else None
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor profile not found")

    return {
        "token": token,
        "user_id": user_id,
        "user": db_user,
        "doctor": doctor,
    }


def _require_doctor_consent(
    appointment_id: int,
    authorization: Optional[str] = Header(None),
) -> dict:
    context = _require_doctor_context(authorization)
    check_consent(doctor_id=context["doctor"]["id"], appointment_id=appointment_id)
    return context


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            parsed = parsed.replace(tzinfo=SRI_LANKA_TZ)
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


def _is_missing_column_error(exc: Exception, column_name: str) -> bool:
    return column_name in str(exc).lower() and "column" in str(exc).lower()


def _insert_availability_rows(rows: list[dict]):
    try:
        return (
            supabase_admin.table("availability_slots")
            .insert(rows)
            .execute()
            .data
            or []
        )
    except Exception:
        raise


def _search_medicines(query: str, limit: int = 8) -> list[dict]:
    normalized = (query or "").strip()
    if len(normalized) < 2:
        return []

    return execute_with_retry(
        lambda: (
            supabase_admin.table("medicines")
            .select("id, name, unit, retail_price, wholesale_price")
            .ilike("name", f"%{normalized}%")
            .order("name")
            .limit(limit)
            .execute()
            .data
            or []
        ),
        default=[],
    )


def _medicine_catalog_item(medicine_id: int) -> Optional[dict]:
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
    return rows[0] if rows else None


def _search_diseases(query: str, limit: int = 12) -> list[dict]:
    normalized = (query or "").strip()
    if len(normalized) < 2:
        return []

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("diseases")
            .select("id, icd, definition, domain")
            .or_(f"icd.ilike.%{normalized}%,definition.ilike.%{normalized}%,domain.ilike.%{normalized}%")
            .order("icd")
            .limit(limit)
            .execute()
            .data
            or []
        ),
        default=[],
    )

    return [
        {
            "id": row.get("id"),
            "code": row.get("icd"),
            "name": row.get("definition"),
            "domain": row.get("domain"),
        }
        for row in rows
    ]


def _resolve_disease(query: str) -> Optional[dict]:
    normalized = (query or "").strip()
    if len(normalized) < 2:
        return None

    exact_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("diseases")
            .select("id, icd, definition, domain")
            .or_(f"icd.ilike.{normalized},definition.ilike.{normalized},domain.ilike.{normalized}")
            .limit(5)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    for row in exact_rows:
        code = str(row.get("icd") or "").strip().lower()
        name = str(row.get("definition") or "").strip().lower()
        if normalized.lower() in {code, name, f"{code} - {name}"}:
            return {
                "id": row.get("id"),
                "code": row.get("icd"),
                "name": row.get("definition"),
                "domain": row.get("domain"),
            }

    search_rows = _search_diseases(normalized, limit=1)
    return search_rows[0] if search_rows else None


def _title_status(value: Optional[str]) -> str:
    return (value or "unknown").replace("_", " ").title()


@router.get("/medicines/search")
def doctor_medicine_search(
    query: str = Query(default=""),
    authorization: Optional[str] = Header(None),
):
    _require_doctor_context(authorization)
    return {
        "items": _search_medicines(query),
    }


@router.get("/diseases/search")
def doctor_disease_search(
    query: str = Query(default=""),
    authorization: Optional[str] = Header(None),
):
    _require_doctor_context(authorization)
    return {
        "items": _search_diseases(query),
    }


def _build_prescription_instructions(
    duration: Optional[str], encounter_type: Optional[str]
) -> str:
    parts = []
    if duration:
        parts.append(f"Duration: {duration}")
    if encounter_type:
        parts.append(f"Encounter type: {encounter_type}")
    return " | ".join(parts)


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


def _patient_map(patient_ids: set[int]):
    if not patient_ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("patients")
            .select("*")
            .in_("id", list(patient_ids))
            .execute()
            .data
            or []
        ),
        default=[],
    )
    user_lookup = _user_map({row["user_id"] for row in rows if row.get("user_id")})

    patient_lookup = {}
    for row in rows:
        linked_user = user_lookup.get(row.get("user_id"), {})
        display_name = (
            linked_user.get("pref_name")
            or linked_user.get("name")
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

    doctor_lookup = {}
    for row in rows:
        linked_user = user_lookup.get(row.get("user_id"), {})
        doctor_lookup[row["id"]] = {
            **row,
            "display_name": linked_user.get("pref_name")
            or linked_user.get("name")
            or linked_user.get("email")
            or f"Doctor #{row['id']}",
            "email": linked_user.get("email"),
        }
    return doctor_lookup


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


def _resolve_hospital_record(hospital_id_or_org_id: int):
    direct = execute_with_retry(
        lambda: (
            supabase_admin.table("hospitals")
            .select("*")
            .eq("id", hospital_id_or_org_id)
            .limit(1)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    if direct:
        return direct[0]

    via_org = execute_with_retry(
        lambda: (
            supabase_admin.table("hospitals")
            .select("*")
            .eq("organisation_id", hospital_id_or_org_id)
            .limit(1)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    if via_org:
        return via_org[0]

    return None


def _doctor_affiliation_rows(doctor_id: int):
    return execute_with_retry(
        lambda: (
            supabase_admin.table("doctor_affiliations")
            .select("*")
            .eq("doctor_id", doctor_id)
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        ),
        default=[],
    )


def _approved_doctor_affiliations(doctor_id: int):
    return [
        row
        for row in _doctor_affiliation_rows(doctor_id)
        if (row.get("status") or "").lower() in {"approved", "active"}
    ]


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


def _safe_record_attachment_filename(filename: Optional[str]) -> str:
    original = filename or "attachment"
    stem, dot, ext = original.rpartition(".")
    base = stem if dot else original
    suffix = f".{ext.lower()}" if dot else ""
    safe_base = re.sub(r"[^a-zA-Z0-9_-]+", "_", base).strip("_") or "attachment"
    return f"{safe_base[:80]}{suffix}"


async def _store_record_attachments(
    *,
    patient_id: int,
    source_role: str,
    source_user_id: Optional[str],
    files: Optional[list[UploadFile]],
    encounter_id: Optional[int] = None,
):
    if not files:
        return []

    stored_rows = []
    for upload in files:
        if not upload or not (upload.filename or "").strip():
            continue

        contents = await validate_upload_file(upload)
        safe_name = _safe_record_attachment_filename(upload.filename)
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
    health_snapshots = _list_patient_health_snapshots(patient_id)
    latest_health_snapshot = health_snapshots[0] if health_snapshots else None
    allergies = []
    if latest_health_snapshot and latest_health_snapshot.get("allergies"):
        allergies = [
            item.strip()
            for item in str(latest_health_snapshot.get("allergies") or "").replace("\n", ",").split(",")
            if item.strip()
        ]

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
        "allergies": allergies,
        "health_snapshot": _format_health_snapshot(latest_health_snapshot),
        "history": history_items,
        "archives": _build_archives(history_items, latest_prescription),
    }


def _build_dashboard_payload(context, active_appointment_id: Optional[int] = None):
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
        .limit(100)
        .execute()
        .data or []
    )
    affiliations = _doctor_affiliation_rows(doctor_id)
    encounters = (
        supabase_admin.table("encounters")
        .select("*")
        .eq("doctor_id", doctor_id)
        .order("created_at", desc=True)
        .limit(100)
        .execute()
        .data or []
    )

    patient_lookup = _patient_map({row["patient_id"] for row in appointments if row.get("patient_id")})
    hospital_lookup = _hospital_map({row["hospital_id"] for row in affiliations if row.get("hospital_id")})
    organisation_lookup = _organisation_map(
        {row["organisation_id"] for row in appointments if row.get("organisation_id")}
        | {
            row["organisation_id"]
            for row in hospital_lookup.values()
            if row.get("organisation_id")
        }
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
    active_schedule_item = None
    if active_appointment_id is not None:
        active_schedule_item = next(
            (item for item in schedule_items if item.get("id") == active_appointment_id),
            None,
        )
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
        hospital = hospital_lookup.get(row.get("hospital_id"), {})
        organisation = organisation_lookup.get(hospital.get("organisation_id"), {})
        affiliation_items.append(
            {
                "id": row["id"],
                "status": _title_status(row.get("status")),
                "created_at": row.get("created_at"),
                "organisation": {
                    "id": hospital.get("organisation_id"),
                    "name": organisation.get("name", f"Hospital #{row.get('hospital_id')}"),
                    "type": organisation.get("type"),
                },
            }
        )

    return {
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user.get("pref_name") or user.get("name"),
            "legal_name": user.get("name"),
            "preferred_name": user.get("pref_name"),
            "address": user.get("address"),
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
                [
                    row
                    for row in affiliations
                    if (row.get("status") or "").lower() in {"approved", "active"}
                ]
            ),
        },
        "active_patient": active_patient,
        "schedule": schedule_items,
        "affiliations": affiliation_items,
    }


def _call_gemini_ai(message: str, history: list[AssistantHistoryMessage], snapshot: dict):
    anon_snapshot = anonymise_and_check(snapshot, context="doctor")
    return call_gemini_assistant(
        {
            "message": message,
            "history": [{"role": item.role, "text": item.text} for item in history[-12:]],
            "doctor_context": anon_snapshot,
            "patient_context": anon_snapshot.get("active_patient"),
        }
    )


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
def get_doctor_dashboard(
    authorization: Optional[str] = Header(None),
    active_appointment_id: Optional[int] = Query(default=None),
):
    context = _require_doctor_context(authorization)
    return _build_dashboard_payload(context, active_appointment_id)


@router.patch("/profile")
def update_doctor_profile(
    payload: ProfileUpdateRequest,
    authorization: Optional[str] = Header(None),
):
    context = _require_doctor_context(authorization)

    updated_user = (
        supabase_admin.table("users")
        .update({"pref_name": payload.preferred_name, "address": payload.address})
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

    user_row = (
        updated_user[0]
        if updated_user
        else {
            **context["user"],
            "pref_name": payload.preferred_name,
            "address": payload.address,
        }
    )
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
            "name": user_row.get("pref_name") or user_row.get("name"),
            "legal_name": user_row.get("name"),
            "preferred_name": user_row.get("pref_name"),
            "address": user_row.get("address"),
        },
        "doctor": {
            "id": doctor_row["id"],
            "specialization": doctor_row.get("specialization"),
            "slmc_number": doctor_row.get("slmc_number"),
        },
    }


@router.post("/encounters/submit")
async def submit_encounter(
    payload: str = Form(...),
    files: Optional[list[UploadFile]] = File(None),
    authorization: Optional[str] = Header(None),
):
    try:
        parsed_payload = EncounterSubmitRequest.model_validate_json(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    context = _require_doctor_context(authorization)
    doctor = context["doctor"]

    # ── Consent Guard (Bihanga B-3.1.1) ──────────────────────────
    # Doctor must have patient consent before accessing history
    if parsed_payload.appointment_id is not None:
        check_consent(
            doctor_id=doctor["id"],
            appointment_id=parsed_payload.appointment_id
        )

    patient_rows = (
        supabase_admin.table("patients")
        .select("*")
        .eq("id", parsed_payload.patient_id)
        .execute()
        .data
        or []
    )
    if not patient_rows:
        raise HTTPException(status_code=404, detail="Patient not found")

    disease = _resolve_disease(parsed_payload.diagnosis)
    if not disease:
        raise HTTPException(
            status_code=400,
            detail="Diagnosis must match a disease from the saved disease catalog search results.",
        )

    normalized_prescription_items = []
    for item in parsed_payload.prescription_items:
        if item.medicine_id is None:
            raise HTTPException(
                status_code=400,
                detail=f"Prescription item '{item.medicine_name}' must use a saved medicine ID from search results.",
            )

        medicine = _medicine_catalog_item(item.medicine_id)
        if not medicine:
            raise HTTPException(
                status_code=404,
                detail=f"Medicine ID {item.medicine_id} was not found in the medicine catalog.",
            )

        normalized_prescription_items.append(
            {
                "medicine_id": medicine["id"],
                "medicine_name": medicine.get("name") or item.medicine_name,
                "dosage": item.dosage,
                "duration": item.duration,
            }
        )

    appointment = None
    if parsed_payload.appointment_id is not None:
        appointment_rows = (
            supabase_admin.table("appointments")
            .select("*")
            .eq("id", parsed_payload.appointment_id)
            .eq("doctor_id", doctor["id"])
            .eq("patient_id", parsed_payload.patient_id)
            .execute()
            .data
            or []
        )
        if not appointment_rows:
            raise HTTPException(status_code=404, detail="Appointment not found for this doctor and patient")
        appointment = appointment_rows[0]

    diagnosis_code = str(disease.get("code") or "").strip()
    diagnosis_name = str(disease.get("name") or "").strip()
    diagnosis_label = (
        f"{diagnosis_code} - {diagnosis_name}"
        if diagnosis_code and diagnosis_name
        else diagnosis_name or diagnosis_code or parsed_payload.diagnosis
    )
    compiled_notes = (
        f"Diagnosis: {diagnosis_label}\n"
        f"Encounter Type: {parsed_payload.encounter_type}\n\n"
        f"{parsed_payload.clinical_notes}"
    )

    encounter_rows = (
        supabase_admin.table("encounters")
        .insert(
            {
                "patient_id": parsed_payload.patient_id,
                "doctor_id": doctor["id"],
                "appointment_id": parsed_payload.appointment_id,
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
    _create_health_snapshot(
        patient_id=parsed_payload.patient_id,
        source_role="doctor",
        source_user_id=context["user_id"],
        snapshot=parsed_payload.health_snapshot,
        encounter_id=encounter["id"],
    )
    await _store_record_attachments(
        patient_id=parsed_payload.patient_id,
        source_role="doctor",
        source_user_id=context["user_id"],
        files=files,
        encounter_id=encounter["id"],
    )
    prescription = None
    if normalized_prescription_items:
        prescription_rows = (
            supabase_admin.table("prescriptions")
            .insert(
                {
                    "patient_id": parsed_payload.patient_id,
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
                        "medicine_id": item["medicine_id"],
                        "medicine_name": item["medicine_name"],
                        "dosage": item["dosage"],
                        "instructions": _build_prescription_instructions(
                            item["duration"],
                            parsed_payload.encounter_type,
                        ),
                    }
                    for item in normalized_prescription_items
                ]
            ).execute()

    if appointment is not None:
        supabase_admin.table("appointments").update({"status": "completed"}).eq(
            "id", appointment["id"]
        ).execute()

        # ── Auto-Revoke Consent (Bihanga B-3.1.2) ─────────────────
        # Automatically revoke patient consent after encounter is finalised
        # Prevents doctor from accessing history after appointment completes
        auto_revoke_consent(
            appointment_id=appointment["id"],
            doctor_user_id=context["user_id"],
            reason="Encounter finalised — consent auto-revoked by system"
        )

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

    if payload.patient_id:
        active_patient = (snapshot.get("active_patient") or {}).get("patient", {})
        if active_patient.get("id") != payload.patient_id:
            schedule = snapshot.get("schedule", [])
            matching = next(
                (item for item in schedule if item.get("patient", {}).get("id") == payload.patient_id),
                None,
            )
            if matching:
                snapshot["active_patient"] = _build_active_patient_bundle(matching, context["doctor"]["id"])

    edge_answer, gemini_issue = _call_gemini_ai(payload.message, payload.history, snapshot)
    if edge_answer:
        # ── Attach disclaimer (Bihanga B-6.2.1) ──────────────────
        return build_safe_response(
            answer = edge_answer,
            source = "gemini_edge",
            role   = "doctor"
        )

    fallback_answer = _doctor_assistant_fallback(payload.message, snapshot)
    if gemini_issue:
        fallback_answer = (
            "Live AI answer is unavailable right now. "
            "I am answering from saved dashboard data only.\n\n"
            f"{fallback_answer}"
        )

    return build_safe_response(
        answer = fallback_answer,
        source = "doctor_fallback",
        role   = "doctor"
    )

@router.post("/availability")
def create_availability_slot(
    payload: AvailabilitySlotCreateRequest,
    authorization: Optional[str] = Header(None),
):
    context = _require_doctor_context(authorization)
    doctor_id = context["doctor"]["id"]

    approved_affiliations = _approved_doctor_affiliations(doctor_id)
    if not approved_affiliations:
        raise HTTPException(
            status_code=400,
            detail="Join an approved hospital before publishing availability slots",
        )

    selected_affiliation = None
    if payload.hospital_id is not None:
        selected_affiliation = next(
            (
                row for row in approved_affiliations
                if int(row.get("hospital_id") or 0) == payload.hospital_id
            ),
            None,
        )
        if not selected_affiliation:
            raise HTTPException(status_code=403, detail="Doctor is not approved for the selected hospital")
    elif len(approved_affiliations) == 1:
        selected_affiliation = approved_affiliations[0]

    if payload.slot_date:
        start_dt = _parse_local_slot_datetime(payload.slot_date, payload.start_time or "")
        end_dt = _parse_local_slot_datetime(payload.slot_date, payload.end_time or "")
        duration = timedelta(minutes=payload.slot_duration_minutes)
    else:
        start_dt = _parse_iso_datetime(payload.start_time)
        end_dt = _parse_iso_datetime(payload.end_time)
        duration = end_dt - start_dt if start_dt and end_dt else timedelta(minutes=0)

    if not start_dt or not end_dt:
        raise HTTPException(status_code=400, detail="Invalid slot date or time")
    if end_dt <= start_dt:
        raise HTTPException(status_code=400, detail="End time must be after start time")
    
    # Ensure the doctor isn't creating slots for a time that has already passed
    now = datetime.now(timezone.utc)

    # If start_dt is 'naive' (no timezone), make it UTC for comparison
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=timezone.utc)

    if start_dt < now:
        raise HTTPException(
            status_code=400, 
            detail="Cannot create availability slots for a past date or time."
        )

    # Prevent overlapping slots
    existing = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("doctor_id", doctor_id)
        .lt("start_time", end_dt.isoformat())
        .gt("end_time", start_dt.isoformat())
        .execute()
        .data
        or []
    )

    if existing:
        raise HTTPException(status_code=400, detail="Slot overlaps with existing availability")

    selected_hospital_id = selected_affiliation.get("hospital_id") if selected_affiliation else payload.hospital_id

    rows = []
    cursor = start_dt
    while cursor + duration <= end_dt:
        row = {
            "doctor_id": doctor_id,
            "hospital_id": selected_hospital_id,
            "start_time": cursor.isoformat(),
            "end_time": (cursor + duration).isoformat(),
        }
        rows.append(row)
        cursor += duration

        if not payload.slot_date:
            break

    if not rows:
        raise HTTPException(status_code=400, detail="No slots could be generated for the selected window")

    slots = _insert_availability_rows(rows)

    return {
        "success": True,
        "created_count": len(slots),
        "slot": slots[0] if slots else None,
        "slots": slots,
    }

@router.get("/availability")
def get_availability(
    authorization: Optional[str] = Header(None),
    slot_date: Optional[str] = Query(default=None),
    hospital_id: Optional[int] = Query(default=None),
):
    context = _require_doctor_context(authorization)
    doctor_id = context["doctor"]["id"]

    query = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("doctor_id", doctor_id)
    )

    if hospital_id is not None:
        selected_affiliation = next(
            (
                row for row in _approved_doctor_affiliations(doctor_id)
                if int(row.get("hospital_id") or 0) == hospital_id
            ),
            None,
        )
        if not selected_affiliation:
            raise HTTPException(status_code=403, detail="Doctor is not approved for the selected hospital")

        query = query.eq("hospital_id", hospital_id)

    try:
        slots = query.order("start_time").execute().data or []
    except Exception as exc:
        if hospital_id is not None and _is_missing_column_error(exc, "hospital_id"):
            raise HTTPException(
                status_code=409,
                detail=(
                    "availability_slots.hospital_id is missing in Supabase. "
                    "Add that column before hospital-specific filtering can work."
                ),
            ) from exc
        raise

    if slot_date:
        slots = [row for row in slots if _local_date(row.get("start_time")) == slot_date]

    return {"slots": slots}

@router.patch("/availability/{slot_id}")
def update_slot(
    slot_id: int,
    payload: AvailabilitySlotUpdateRequest,
    authorization: Optional[str] = Header(None),
):
    context = _require_doctor_context(authorization)
    doctor_id = context["doctor"]["id"]

    current_rows = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("id", slot_id)
        .eq("doctor_id", doctor_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not current_rows:
        raise HTTPException(status_code=404, detail="Slot not found")

    current = current_rows[0]
    if current.get("is_booked"):
        raise HTTPException(status_code=400, detail="Cannot reschedule a booked slot")

    hospital_id = current.get("hospital_id")
    if hospital_id:
        selected_affiliation = next(
            (
                row
                for row in _approved_doctor_affiliations(doctor_id)
                if int(row.get("hospital_id") or 0) == int(hospital_id)
            ),
            None,
        )
        if not selected_affiliation:
            raise HTTPException(status_code=403, detail="Doctor is not approved for this slot hospital")

    start_dt = _parse_iso_datetime(payload.start_time)
    end_dt = _parse_iso_datetime(payload.end_time)
    if not start_dt or not end_dt:
        raise HTTPException(status_code=400, detail="Invalid slot date or time")
    if end_dt <= start_dt:
        raise HTTPException(status_code=400, detail="End time must be after start time")

    overlaps = (
        supabase_admin.table("availability_slots")
        .select("*")
        .eq("doctor_id", doctor_id)
        .neq("id", slot_id)
        .lt("start_time", end_dt.isoformat())
        .gt("end_time", start_dt.isoformat())
        .execute()
        .data
        or []
    )
    if overlaps:
        raise HTTPException(status_code=409, detail="Updated slot overlaps existing availability")

    updated = (
        supabase_admin.table("availability_slots")
        .update({"start_time": start_dt.isoformat(), "end_time": end_dt.isoformat()})
        .eq("id", slot_id)
        .execute()
        .data
        or []
    )

    return {"success": True, "slot": updated[0] if updated else None}

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

@router.put("/invite/accept/{invitation_id}")
def accept_invitation(
    invitation_id: str,
    authorization: Optional[str] = Header(None),
):
    context = _require_doctor_context(authorization)
    doctor_id = str(context["doctor"]["id"])

    invitation = supabase_admin.table("doctor_invitations") \
        .select("*") \
        .eq("id", invitation_id) \
        .single() \
        .execute()

    if not invitation.data:
        raise HTTPException(404, "Invitation not found")

    if invitation.data.get("doctor_email") != context["user"].get("email"):
        raise HTTPException(403, "This invitation was not sent to you.")

    # create affiliation
    supabase_admin.table("doctor_affiliations").insert({
        "doctor_id": doctor_id,
        "hospital_id": invitation.data["hospital_id"],
        "status": "APPROVED",
        "approved_at": datetime.utcnow().isoformat()
    }).execute()

    # mark invitation accepted
    supabase_admin.table("doctor_invitations").update({
        "status": "ACCEPTED"
    }).eq("id", invitation_id).execute()

    return {"message": "Joined hospital"}

@router.post("/upload-license")
async def upload_license(
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
):
    """
    Uploads a doctor's SLMC license document.
    Accepts PDF and JPG files only, max 5MB.
    Validates file type using magic bytes (not just extension).
    """
    context = _require_doctor_context(authorization)
    user_id = context["user_id"]

    # ── Validate file (Bihanga B-2.1.1) ──────────────────────────
    contents = await validate_upload_file(file)

    # ── Create safe filename ──────────────────────────────────────
    safe_filename = sanitize_filename(file.filename, user_id)

    # ── Upload to Supabase Storage ────────────────────────────────
    try:
        storage_path = f"licenses/{safe_filename}"

        supabase_admin.storage.from_("doctor-documents").upload(
            path=storage_path,
            file=contents,
            file_options={"content-type": file.content_type or "application/octet-stream"}
        )

        # Get public URL
        file_url = supabase_admin.storage.from_("doctor-documents").get_public_url(storage_path)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail="File could not be uploaded. Please try again."
        )

    # ── Log the upload ────────────────────────────────────────────
    _log_audit_action(user_id, "LICENSE_UPLOADED", "doctors", context["doctor"]["id"])

    return {
        "success":   True,
        "filename":  safe_filename,
        "file_url":  file_url,
        "message":   "SLMC license uploaded successfully",
        "file_size": f"{len(contents) / 1024:.1f}KB",
    }

@router.get("/patients/{patient_id}/history")
def get_patient_history(
    patient_id: int,
    appointment_id: int,
    context: dict = Depends(_require_doctor_consent),
):
    """
    Returns a patient's medical history for a specific appointment.
    Requires patient consent — blocked with 403 if not granted.
    Consent Guard applied (Bihanga B-3.1.1)
    """
    doctor = context["doctor"]

    # ── Fetch patient encounters ──────────────────────────────────
    try:
        encounters = (
            supabase_admin.table("encounters")
            .select("*")
            .eq("patient_id", patient_id)
            .order("created_at", desc=True)
            .execute()
            .data or []
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not fetch patient history"
        )

    # ── Fetch prescriptions ───────────────────────────────────────
    encounter_ids = [e["id"] for e in encounters]
    prescriptions = []
    if encounter_ids:
        try:
            prescriptions = (
                supabase_admin.table("prescriptions")
                .select("*")
                .in_("encounter_id", encounter_ids)
                .execute()
                .data or []
            )
        except Exception:
            pass

    prescriptions_map = {}
    for p in prescriptions:
        prescriptions_map.setdefault(p["encounter_id"], []).append(p)

    # ── Log the access ────────────────────────────────────────────
    _log_audit_action(
        context["user_id"],
        "PATIENT_HISTORY_ACCESSED",
        "encounters",
        patient_id
    )

    return {
        "patient_id":   patient_id,
        "doctor_id":    doctor["id"],
        "consent":      "granted",
        "encounters":   [
            {
                "id":           e.get("id"),
                "created_at":   e.get("created_at"),
                "notes":        e.get("notes"),
                "prescriptions": prescriptions_map.get(e["id"], [])
            }
            for e in encounters
        ]
    }

@router.post("/affiliation/request")
def request_affiliation(
    data: AffiliationRequest,
    authorization: Optional[str] = Header(None),
):
    context = _require_doctor_context(authorization)
    doctor_id = context["doctor"]["id"]

    hospital_record = _resolve_hospital_record(data.hospital_id)
    if not hospital_record:
        raise HTTPException(status_code=404, detail="Hospital not found")

    hospital_rows = (
        supabase_admin.table("organisations")
        .select("id, name, type, status")
        .eq("id", hospital_record["organisation_id"])
        .limit(1)
        .execute()
        .data
        or []
    )
    if not hospital_rows:
        raise HTTPException(status_code=404, detail="Hospital organisation not found")
    hospital = hospital_rows[0]

    if (hospital.get("type") or "").lower() != "hospital":
        raise HTTPException(status_code=400, detail="Selected organisation is not a hospital")

    if (hospital.get("status") or "").lower() != "approved":
        raise HTTPException(status_code=400, detail="Hospital is not approved for doctor affiliation yet")

    existing = (
        supabase_admin.table("doctor_affiliations")
        .select("*")
        .eq("doctor_id", doctor_id)
        .eq("hospital_id", hospital_record["id"])
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )

    if existing:
        current = existing[0]
        current_status = (current.get("status") or "").lower()
        if current_status in {"pending", "approved", "active"}:
            raise HTTPException(
                status_code=409,
                detail="You already have an active or pending request for this hospital",
            )

        supabase_admin.table("doctor_affiliations").update(
            {"status": "pending"}
        ).eq("id", current["id"]).execute()
        affiliation_id = current["id"]
    else:
        created = (
            supabase_admin.table("doctor_affiliations")
            .insert(
                {
                    "doctor_id": doctor_id,
                    "hospital_id": hospital_record["id"],
                    "status": "pending",
                }
            )
            .execute()
            .data
            or []
        )
        if not created:
            raise HTTPException(status_code=500, detail="Affiliation request could not be created")
        affiliation_id = created[0]["id"]

    _log_audit_action(context["user_id"], "AFFILIATION_REQUESTED", "doctor_affiliations", affiliation_id)
    return {"message": "Hospital join request sent", "affiliation_id": affiliation_id}

@router.get("/affiliations/hospitals")
def list_hospital_affiliation_options(authorization: Optional[str] = Header(None)):
    context = _require_doctor_context(authorization)
    doctor_id = context["doctor"]["id"]

    hospitals = (
        supabase_admin.table("hospitals")
        .select("*")
        .order("id")
        .execute()
        .data
        or []
    )
    affiliations = _doctor_affiliation_rows(doctor_id)
    organisation_lookup = _organisation_map(
        {row["organisation_id"] for row in hospitals if row.get("organisation_id")}
    )

    latest_by_hospital = {}
    for row in affiliations:
        hospital_id = row.get("hospital_id")
        if hospital_id and hospital_id not in latest_by_hospital:
            latest_by_hospital[hospital_id] = row

    items = []
    for hospital in hospitals:
        organisation = organisation_lookup.get(hospital.get("organisation_id"), {})
        current = latest_by_hospital.get(hospital["id"])
        current_status = _title_status(current.get("status")) if current else None
        current_status_normalized = (current.get("status") or "").lower() if current else ""
        items.append(
            {
                "id": hospital["id"],
                "name": organisation.get("name", f"Hospital #{hospital['id']}"),
                "type": organisation.get("type"),
                "status": organisation.get("status"),
                "current_affiliation_id": current.get("id") if current else None,
                "current_status": current_status,
                "can_request": current is None or current_status_normalized in {"rejected", "revoked"},
            }
        )

    return {"hospitals": items}


@router.put("/affiliation/revoke")
def revoke_affiliation(
    payload: AffiliationRevokeRequest,
    authorization: Optional[str] = Header(None),
):
    context = _require_doctor_context(authorization)
    doctor_id = context["doctor"]["id"]

    existing = (
        supabase_admin.table("doctor_affiliations")
        .select("*")
        .eq("id", payload.affiliation_id)
        .eq("doctor_id", doctor_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Affiliation not found for this doctor")

    current = existing[0]
    current_status = (current.get("status") or "").lower()
    if current_status == "revoked":
        return {"message": "Affiliation already revoked", "affiliation_id": current["id"]}

    supabase_admin.table("doctor_affiliations").update({"status": "revoked"}).eq(
        "id", current["id"]
    ).execute()

    _log_audit_action(context["user_id"], "AFFILIATION_REVOKED", "doctor_affiliations", current["id"])

    return {"message": "Affiliation revoked", "affiliation_id": current["id"]}

@router.post("/upload-attachment")
async def upload(
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
):
    _require_doctor_context(authorization)
    file_id = str(uuid.uuid4())
    path = f"attachments/{file_id}_{file.filename}"

    try:
        contents = await file.read()
        supabase_admin.storage.from_("records").upload(
            path,
            contents,
            file_options={"content-type": file.content_type or "application/octet-stream"},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail="File upload failed") from exc

    url = supabase_admin.storage.from_("records").get_public_url(path)

    return {"file_url": url}
