# app/routes/pharmacist_dashboard.py
# Pharmacist dashboard endpoints
# Signature verification added by Bihanga (B-4.1.2)

from datetime import datetime, timedelta
import math
import re
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.config.supabase import execute_with_retry, supabase, supabase_admin
from app.middleware.role_checker import RoleChecker, PharmacistOnly, build_user_context
from app.schemas.pharmacist_schema import DispenseRequest
from app.utils.helpers import validate_dhid

router = APIRouter(prefix="/pharmacist/dashboard", tags=["Pharmacist-dashboard"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class BillItem(BaseModel):
    inventory_id: int
    quantity:     int = Field(..., gt=0)


class BillRequest(BaseModel):
    pharmacy_id:     int
    prescription_id: int
    items:           list[BillItem]


class UpdatePharmacistProfileRequest(BaseModel):
    preferred_name: str = Field(min_length=2, max_length=120)
    address: str = Field(min_length=5, max_length=255)

    @field_validator("preferred_name", "address")
    @classmethod
    def validate_text(cls, value: str):
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Field cannot be empty")
        return cleaned


# ── Helper ────────────────────────────────────────────────────────────────────

def _coerce_int(value) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip():
        try:
            return int(float(value.strip()))
        except ValueError:
            return None
    return None


def _parse_positive_integer(value) -> Optional[int]:
    direct_value = _coerce_int(value)
    if direct_value is not None and direct_value > 0:
        return direct_value

    if isinstance(value, str):
        match = re.search(r"(\d+)", value)
        if match:
            parsed = _coerce_int(match.group(1))
            if parsed is not None and parsed > 0:
                return parsed

    return None


def _parse_duration_days(instructions: str | None) -> Optional[int]:
    normalized = (instructions or "").strip()
    if not normalized:
        return None

    match = re.search(r"Duration:\s*(\d+)", normalized, re.IGNORECASE)
    if not match:
        return None

    parsed = _coerce_int(match.group(1))
    return parsed if parsed is not None and parsed > 0 else None


def _normalize_unit_kind_from_text(value: str | None) -> Optional[str]:
    normalized = (value or "").strip().lower()
    if not normalized:
        return None

    if (
        normalized in {"tablet", "tablets", "tab", "tabs", "cap", "caps", "capsule", "capsules"}
        or re.search(r"\btab(?:let)?s?\b", normalized)
        or re.search(r"\bcap(?:sule)?s?\b", normalized)
    ):
        return "tablets"

    if (
        normalized in {"drop", "drops", "gtt"}
        or re.search(r"\b(drop|drops|gtt)\b", normalized)
    ):
        return "drops"

    if (
        normalized in {"ml", "milliliter", "milliliters"}
        or re.search(r"\bml\b", normalized)
        or re.search(r"\bmilliliters?\b", normalized)
    ):
        return "ml"

    return None


def _resolve_medicine_for_item(item: dict) -> Optional[dict]:
    medicine_id = _coerce_int(item.get("medicine_id"))
    if medicine_id is not None:
        medicine = _medicine_by_id(medicine_id)
        if medicine:
            return medicine

    medicine_name = item.get("medicine_name") or item.get("drug_name")
    if isinstance(medicine_name, str) and medicine_name.strip():
        return _medicine_by_name(medicine_name)

    return None


def _parse_package_capacity(item: dict, medicine: dict | None) -> Optional[float]:
    candidates = [
        (medicine or {}).get("unit"),
        (medicine or {}).get("name"),
        item.get("unit"),
        item.get("medicine_name"),
        item.get("drug_name"),
    ]

    for candidate in candidates:
        normalized = (candidate or "").strip().lower() if isinstance(candidate, str) else ""
        if not normalized:
            continue

        match = re.search(r"(\d+(?:\.\d+)?)\s*(ml|drops?|bottle|tab(?:let)?s?)", normalized, re.IGNORECASE)
        if not match:
            match = re.search(r"(\d+(?:\.\d+)?)", normalized)

        if not match:
            continue

        try:
            parsed = float(match.group(1))
        except ValueError:
            continue

        if parsed > 0:
            return parsed

    return None


def _parse_tablet_price_divisor(*candidates) -> Optional[int]:
    for candidate in candidates:
        normalized = (candidate or "").strip().lower() if isinstance(candidate, str) else ""
        if not normalized:
            continue

        match = (
            re.search(r"(\d+)\s*(t|tabs?|tablets?|c|caps?|capsules?)\b", normalized, re.IGNORECASE)
            or re.search(r"\b(\d+)(t|c)\b", normalized, re.IGNORECASE)
        )
        if not match:
            continue

        parsed = _coerce_int(match.group(1))
        if parsed is not None and parsed > 0:
            return parsed

    return None


def _effective_server_unit_price(
    base_price: float | int | None,
    medicine: dict | None,
    item: dict | None = None,
) -> float:
    normalized_price = float(base_price or 0)
    if normalized_price <= 0:
        return 0.0

    item = item or {}
    unit_kind = (
        _normalize_unit_kind_from_text(item.get("unit"))
        or _normalize_unit_kind_from_text((medicine or {}).get("unit"))
        or _normalize_unit_kind_from_text((medicine or {}).get("name"))
        or _normalize_unit_kind_from_text(item.get("medicine_name"))
        or _normalize_unit_kind_from_text(item.get("drug_name"))
    )

    if unit_kind == "tablets":
        divisor = _parse_tablet_price_divisor(
            (medicine or {}).get("unit"),
            (medicine or {}).get("name"),
            item.get("unit"),
            item.get("medicine_name"),
            item.get("drug_name"),
        )
        if divisor:
            return normalized_price / divisor

    return normalized_price


def _computed_prescribed_quantity(item: dict) -> Optional[int]:
    medicine = _resolve_medicine_for_item(item)
    unit_kind = (
        _normalize_unit_kind_from_text(item.get("unit"))
        or _normalize_unit_kind_from_text((medicine or {}).get("unit"))
        or _normalize_unit_kind_from_text((medicine or {}).get("name"))
        or _normalize_unit_kind_from_text(item.get("medicine_name"))
        or _normalize_unit_kind_from_text(item.get("drug_name"))
    )
    daily_dose = _parse_positive_integer(item.get("dosage"))
    duration_days = _parse_duration_days(item.get("instructions"))

    if unit_kind is None or daily_dose is None or duration_days is None:
        return None

    if unit_kind == "tablets":
        return daily_dose * duration_days

    if unit_kind in {"ml", "drops"}:
        package_capacity = _parse_package_capacity(item, medicine)
        total_volume = (daily_dose * duration_days) / 20 if unit_kind == "drops" else daily_dose * duration_days
        if total_volume <= 0:
            return None
        if package_capacity and package_capacity > 0:
            return max(math.ceil(total_volume / package_capacity), 1)
        return max(int(total_volume), 1)

    return None


def _prescribed_quantity(item: dict) -> int:
    computed_quantity = _computed_prescribed_quantity(item)
    if computed_quantity is not None and computed_quantity > 0:
        return computed_quantity

    direct_quantity = _coerce_int(item.get("quantity"))
    if direct_quantity is not None and direct_quantity > 0:
        return direct_quantity

    direct_quantity = _coerce_int(item.get("quantity_prescribed"))
    if direct_quantity is not None and direct_quantity > 0:
        return direct_quantity

    instructions = item.get("instructions") or ""
    quantity_match = re.search(r"Quantity:\s*(\d+)", instructions, re.IGNORECASE)
    if quantity_match:
        parsed_quantity = _coerce_int(quantity_match.group(1))
        if parsed_quantity is not None and parsed_quantity > 0:
            return parsed_quantity

    dispensed_quantity = _coerce_int(item.get("dispensed_quantity")) or 0
    return max(dispensed_quantity, 1)


def _serialize_prescription_item(item: dict) -> dict:
    prescribed_quantity = _prescribed_quantity(item)
    return {
        **item,
        "quantity": prescribed_quantity,
        "quantity_prescribed": prescribed_quantity,
        "dispensed_quantity": _coerce_int(item.get("dispensed_quantity")) or 0,
    }


def _sorted_unique(values):
    return sorted({value for value in values if value is not None})


def _parse_iso_datetime(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        try:
            return datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _resolve_prescription_expiry(row: dict) -> Optional[str]:
    created_at = _parse_iso_datetime(row.get("created_at"))
    valid_period = _coerce_int(row.get("valid_period"))
    if created_at is None or valid_period is None:
        return None
    return (created_at + timedelta(days=valid_period)).astimezone().isoformat()


def _is_prescription_within_valid_period(row: dict) -> bool:
    status = (row.get("status") or "").strip().lower()
    if status != "active":
        return False

    created_at = _parse_iso_datetime(row.get("created_at"))
    valid_period = _coerce_int(row.get("valid_period"))
    if created_at is None or valid_period is None:
        return True

    return created_at + timedelta(days=valid_period) >= datetime.now().astimezone()


def _user_map(user_ids) -> dict:
    ids = _sorted_unique(user_ids)
    if not ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("users")
            .select("id, name, email, pref_name")
            .in_("id", ids)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    return {row["id"]: row for row in rows}


def _patient_map(patient_ids) -> dict:
    ids = _sorted_unique(patient_ids)
    if not ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("patients")
            .select("*")
            .in_("id", ids)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    user_lookup = _user_map({row.get("user_id") for row in rows if row.get("user_id")})

    mapped = {}
    for row in rows:
        user = user_lookup.get(row.get("user_id"), {})
        mapped[row["id"]] = {
            **row,
            "name": user.get("pref_name") or user.get("name"),
            "preferred_name": user.get("pref_name"),
            "email": user.get("email"),
        }
    return mapped


def _doctor_map(doctor_ids) -> dict:
    ids = _sorted_unique(doctor_ids)
    if not ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("doctors")
            .select("*")
            .in_("id", ids)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    user_lookup = _user_map({row.get("user_id") for row in rows if row.get("user_id")})

    mapped = {}
    for row in rows:
        user = user_lookup.get(row.get("user_id"), {})
        mapped[row["id"]] = {
            **row,
            "name": user.get("pref_name") or user.get("name"),
            "preferred_name": user.get("pref_name"),
            "email": user.get("email"),
        }
    return mapped


def _organisation_map(organisation_ids) -> dict:
    ids = _sorted_unique(organisation_ids)
    if not ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("organisations")
            .select("*")
            .in_("id", ids)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    return {row["id"]: row for row in rows}


def _medicine_map(medicine_ids) -> dict:
    ids = _sorted_unique(medicine_ids)
    if not ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("medicines")
            .select("id, name, retail_price, wholesale_price, unit")
            .in_("id", ids)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    return {row["id"]: row for row in rows}


def _medicine_by_id(medicine_id: int | None) -> Optional[dict]:
    if medicine_id is None:
        return None

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("medicines")
            .select("id, name, retail_price, wholesale_price, unit")
            .eq("id", medicine_id)
            .limit(1)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    return rows[0] if rows else None


def _medicine_by_name(medicine_name: str) -> Optional[dict]:
    normalized = (medicine_name or "").strip()
    if not normalized:
        return None

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("medicines")
            .select("id, name, retail_price, wholesale_price, unit")
            .ilike("name", normalized)
            .limit(1)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    if rows:
        return rows[0]

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("medicines")
            .select("id, name, retail_price, wholesale_price, unit")
            .ilike("name", f"%{normalized}%")
            .limit(1)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    return rows[0] if rows else None


def _inventory_display_name(item: dict, medicine_lookup: dict | None = None) -> str:
    medicine_lookup = medicine_lookup or {}
    medicine = medicine_lookup.get(item.get("medicine_id"), {})
    return (
        medicine.get("name")
        or item.get("medicine_name")
        or item.get("drug_name")
        or f"Medicine #{item.get('medicine_id') or item.get('id')}"
    )


def _encounter_map(encounter_ids) -> dict:
    ids = _sorted_unique(encounter_ids)
    if not ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("encounters")
            .select("id, appointment_id, encounter_type, notes")
            .in_("id", ids)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    return {row["id"]: row for row in rows}


def _doctor_primary_organisation_map(doctor_ids) -> dict:
    ids = _sorted_unique(doctor_ids)
    if not ids:
        return {}

    affiliation_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("doctor_affiliations")
            .select("doctor_id, hospital_id, status, created_at")
            .in_("doctor_id", ids)
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    approved_rows = [
        row for row in affiliation_rows if (row.get("status") or "").lower() in {"approved", "active"}
    ]
    hospital_ids = {
        row.get("hospital_id") for row in approved_rows if row.get("hospital_id") is not None
    }
    if not hospital_ids:
        return {}

    hospital_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("hospitals")
            .select("id, organisation_id")
            .in_("id", list(hospital_ids))
            .execute()
            .data
            or []
        ),
        default=list,
    )
    hospital_lookup = {row["id"]: row for row in hospital_rows if row.get("id") is not None}
    organisation_lookup = _organisation_map(
        {
            row.get("organisation_id")
            for row in hospital_rows
            if row.get("organisation_id") is not None
        }
    )

    primary_by_doctor = {}
    for row in approved_rows:
        doctor_id = row.get("doctor_id")
        hospital = hospital_lookup.get(row.get("hospital_id"))
        organisation = organisation_lookup.get(hospital.get("organisation_id"), {}) if hospital else {}
        if doctor_id is not None and doctor_id not in primary_by_doctor and organisation:
            primary_by_doctor[doctor_id] = organisation

    return primary_by_doctor


def _encounter_type_from_row(encounter: dict | None) -> str | None:
    encounter = encounter or {}
    direct = encounter.get("encounter_type")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()

    notes = encounter.get("notes")
    if isinstance(notes, str):
        match = re.search(r"Encounter Type:\s*(.+)", notes, re.IGNORECASE)
        if match:
            return match.group(1).strip()

    return None


def _encounter_type_from_prescription_items(items: list[dict] | None) -> str | None:
    for item in items or []:
      instructions = item.get("instructions")
      if isinstance(instructions, str):
          match = re.search(r"Encounter type:\s*([^|,\n]+)", instructions, re.IGNORECASE)
          if match:
              return match.group(1).strip()

    return None


def _appointment_map(appointment_ids) -> dict:
    ids = _sorted_unique(appointment_ids)
    if not ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("appointments")
            .select("id, organisation_id")
            .in_("id", ids)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    return {row["id"]: row for row in rows}


def _pharmacy_map_by_organisation(organisation_ids) -> dict:
    ids = _sorted_unique(organisation_ids)
    if not ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("pharmacies")
            .select("*")
            .in_("organisation_id", ids)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    return {row["organisation_id"]: row for row in rows if row.get("organisation_id") is not None}


def _pharmacy_by_id(pharmacy_id: int | None) -> Optional[dict]:
    if pharmacy_id is None:
        return None

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("pharmacies")
            .select("*")
            .eq("id", pharmacy_id)
            .limit(1)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    return rows[0] if rows else None


def _resolve_pharmacist_pharmacy(user: dict, requested_identifier: int | None = None) -> dict:
    pharmacy_id = _coerce_int(user.get("pharmacy_id"))
    organisation_id = _coerce_int(user.get("organisation_id"))

    pharmacy = _pharmacy_by_id(pharmacy_id)
    if pharmacy is None and organisation_id is not None:
        pharmacy = _pharmacy_map_by_organisation({organisation_id}).get(organisation_id)

    if not pharmacy:
        raise HTTPException(
            status_code=403,
            detail="Each pharmacist must be affiliated with at least one pharmacy before using dispensing features.",
        )

    requested_id = _coerce_int(requested_identifier)
    if requested_id is not None and requested_id not in {
        _coerce_int(pharmacy.get("id")),
        _coerce_int(pharmacy.get("organisation_id")),
    }:
        raise HTTPException(
            status_code=403,
            detail="You can only operate against your affiliated pharmacy.",
        )

    return pharmacy


def _prescription_items_by_prescription(prescription_ids) -> dict:
    ids = _sorted_unique(prescription_ids)
    if not ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("prescription_items")
            .select("*")
            .in_("prescription_id", ids)
            .execute()
            .data
            or []
        ),
        default=list,
    )

    mapped = {}
    for row in rows:
        mapped.setdefault(row["prescription_id"], []).append(_serialize_prescription_item(row))
    return mapped


def _inventory_map_for_pharmacy(pharmacy_id: int | None, medicine_ids) -> dict:
    ids = _sorted_unique(medicine_ids)
    if not pharmacy_id or not ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("inventory")
            .select("id, medicine_id, stock_quantity, unit_price")
            .eq("pharmacy_id", pharmacy_id)
            .in_("medicine_id", ids)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    return {
        row["medicine_id"]: row
        for row in rows
        if row.get("medicine_id") is not None
    }


def _inventory_rows_for_pharmacy(pharmacy_id: int):
    return execute_with_retry(
        lambda: (
            supabase_admin.table("inventory")
            .select("*")
            .eq("pharmacy_id", pharmacy_id)
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        ),
        default=list,
    )


def _build_prescription_context(prescriptions: list[dict]) -> dict:
    encounter_lookup = _encounter_map(
        {row.get("encounter_id") for row in prescriptions if row.get("encounter_id")}
    )
    appointment_lookup = _appointment_map(
        {
            row.get("appointment_id")
            for row in encounter_lookup.values()
            if row.get("appointment_id")
        }
    )
    organisation_lookup = _organisation_map(
        {
            row.get("organisation_id")
            for row in appointment_lookup.values()
            if row.get("organisation_id")
        }
    )

    return {
        "patient_lookup": _patient_map({row.get("patient_id") for row in prescriptions if row.get("patient_id")}),
        "doctor_lookup": _doctor_map({row.get("doctor_id") for row in prescriptions if row.get("doctor_id")}),
        "doctor_organisation_lookup": _doctor_primary_organisation_map(
            {row.get("doctor_id") for row in prescriptions if row.get("doctor_id")}
        ),
        "encounter_lookup": encounter_lookup,
        "appointment_lookup": appointment_lookup,
        "organisation_lookup": organisation_lookup,
        "prescription_items_lookup": _prescription_items_by_prescription(
            {row.get("id") for row in prescriptions if row.get("id")}
        ),
    }


def _serialize_prescription_summary(
    row: dict,
    *,
    patient_lookup: dict,
    doctor_lookup: dict,
    doctor_organisation_lookup: dict,
    encounter_lookup: dict,
    appointment_lookup: dict,
    organisation_lookup: dict,
    prescription_items_lookup: dict,
) -> dict:
    patient = patient_lookup.get(row.get("patient_id"), {})
    doctor = doctor_lookup.get(row.get("doctor_id"), {})
    encounter = encounter_lookup.get(row.get("encounter_id"), {})
    appointment = appointment_lookup.get(encounter.get("appointment_id"), {})
    organisation = organisation_lookup.get(appointment.get("organisation_id"), {}) or doctor_organisation_lookup.get(
        row.get("doctor_id"),
        {},
    )
    prescription_items = prescription_items_lookup.get(row.get("id"), [])

    organisation_name = organisation.get("name")
    return {
        "id": row.get("id"),
        "status": row.get("status"),
        "patient_id": row.get("patient_id"),
        "doctor_id": row.get("doctor_id"),
        "created_at": row.get("created_at"),
        "issued_at": row.get("created_at"),
        "patient_dhid": patient.get("dhid"),
        "patient_name": patient.get("preferred_name") or patient.get("name"),
        "doctor_name": doctor.get("preferred_name") or doctor.get("name"),
        "encounter_type": _encounter_type_from_row(encounter)
        or _encounter_type_from_prescription_items(prescription_items),
        "hospital_name": organisation_name,
        "organisation_name": organisation_name,
        "expires_at": _resolve_prescription_expiry(row),
        "total_items": len(prescription_items),
        "signature_valid": None,
    }


def _dispensing_history_entries(dispensing_rows: list[dict]) -> list[dict]:
    if not dispensing_rows:
        return []

    prescription_ids = {row.get("prescription_id") for row in dispensing_rows if row.get("prescription_id")}
    prescriptions = execute_with_retry(
        lambda: (
            supabase_admin.table("prescriptions")
            .select("id, patient_id, doctor_id")
            .in_("id", list(prescription_ids))
            .execute()
            .data
            or []
        ),
        default=list,
    ) if prescription_ids else []
    prescription_lookup = {row["id"]: row for row in prescriptions}

    patient_lookup = _patient_map(
        {row.get("patient_id") for row in prescriptions if row.get("patient_id")}
    )
    doctor_lookup = _doctor_map(
        {row.get("doctor_id") for row in prescriptions if row.get("doctor_id")}
    )

    dispensing_ids = {row.get("id") for row in dispensing_rows if row.get("id")}
    billing_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("billing")
            .select("*")
            .in_("dispensing_id", list(dispensing_ids))
            .execute()
            .data
            or []
        ),
        default=list,
    ) if dispensing_ids else []
    billing_lookup = {
        row.get("dispensing_id"): row
        for row in billing_rows
        if row.get("dispensing_id") is not None
    }

    dispensing_item_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("dispensing_items")
            .select("*")
            .in_("dispensing_id", list(dispensing_ids))
            .execute()
            .data
            or []
        ),
        default=list,
    ) if dispensing_ids else []
    item_count_lookup = {}
    for row in dispensing_item_rows:
        dispensing_id = row.get("dispensing_id")
        if dispensing_id is None:
            continue
        item_count_lookup[dispensing_id] = item_count_lookup.get(dispensing_id, 0) + 1

    history = []
    for row in dispensing_rows:
        prescription = prescription_lookup.get(row.get("prescription_id"), {})
        patient = patient_lookup.get(prescription.get("patient_id"), {})
        doctor = doctor_lookup.get(prescription.get("doctor_id"), {})
        billing = billing_lookup.get(row.get("id"), {})

        history.append(
            {
                "id": row.get("id"),
                "prescription_id": row.get("prescription_id"),
                "status": row.get("status"),
                "dispensed_at": row.get("created_at") or row.get("dispensed_at"),
                "pharmacist_id": row.get("pharmacist_id"),
                "patient_dhid": patient.get("dhid"),
                "patient_name": patient.get("preferred_name") or patient.get("name"),
                "doctor_name": doctor.get("preferred_name") or doctor.get("name"),
                "item_count": item_count_lookup.get(row.get("id"), 0),
                "estimated_total": billing.get("total_amount") or row.get("total_price") or 0,
            }
        )

    return history


def reduce_stock(medicine_id: int, pharmacy_id: int, quantity: int) -> dict:
    medicine = _medicine_by_id(medicine_id)
    if not medicine:
        raise HTTPException(404, f"Medicine ID {medicine_id} is not registered in the medicines catalog.")

    item = execute_with_retry(
        lambda: (
            supabase_admin.table("inventory")
            .select("id, medicine_id, stock_quantity, unit_price")
            .eq("medicine_id", medicine["id"])
            .eq("pharmacy_id", pharmacy_id)
            .single()
            .execute()
        )
    )

    if not item.data:
        raise HTTPException(404, f"Medicine ID {medicine_id} is not stocked in pharmacy {pharmacy_id}.")

    current_stock = item.data.get("stock_quantity", 0)
    if current_stock < quantity:
        raise HTTPException(
            400,
            f"Not enough stock for {medicine.get('name') or f'Medicine ID {medicine_id}'}. Available: {current_stock}",
        )

    supabase_admin.table("inventory").update({
        "stock_quantity": current_stock - quantity,
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("id", item.data["id"]).execute()
    return {
        **item.data,
        "medicine_name": medicine.get("name") or f"Medicine ID {medicine_id}",
        "unit_price": item.data.get("unit_price") or medicine.get("retail_price") or 0,
    }


# ── Prescription Endpoints ────────────────────────────────────────────────────

@router.get("/prescriptions", dependencies=[Depends(PharmacistOnly)])
def get_prescriptions():
    """
    Returns all active prescriptions for dispensing.
    Pharmacists only.
    Clinical notes and encounter data are deliberately excluded.
    Only pharmacy-relevant fields are returned (B-4.2.1)
    """
    prescriptions = execute_with_retry(
        lambda: (
            supabase_admin.table("prescriptions")
            .select("id, status, created_at, patient_id, doctor_id, encounter_id, valid_period")
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    prescriptions = [row for row in prescriptions if _is_prescription_within_valid_period(row)]
    context = _build_prescription_context(prescriptions)
    return [
        _serialize_prescription_summary(row, **context)
        for row in prescriptions
    ]


@router.get("/prescriptions/{prescription_id}")
def get_prescription_details(
    prescription_id: str,
    user: dict = Depends(PharmacistOnly),
):
    """
    Returns prescription details and items for dispensing.
    Pharmacists only.
    Clinical notes and encounter data strictly excluded (B-4.2.1)
    """
    # ── Pharmacy-safe prescription fields only ────────────────────
    prescription = execute_with_retry(
        lambda: (
            supabase_admin.table("prescriptions")
            .select("id, status, created_at, patient_id, doctor_id, encounter_id")
            .eq("id", prescription_id)
            .single()
            .execute()
        )
    )

    if not prescription.data:
        raise HTTPException(status_code=404, detail="Prescription not found")

    context = _build_prescription_context([prescription.data])
    dispensing_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("dispensing")
            .select("*")
            .eq("prescription_id", prescription_id)
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        ),
        default=list,
    )

    pharmacy = _resolve_pharmacist_pharmacy(user)
    pharmacy_id = pharmacy.get("id")

    items = context["prescription_items_lookup"].get(prescription.data["id"], [])
    medicine_ids = {
        item.get("medicine_id")
        for item in items
        if item.get("medicine_id") is not None
    }

    inventory_lookup = _inventory_map_for_pharmacy(pharmacy_id, medicine_ids)
    medicine_lookup = _medicine_map(medicine_ids)
    enriched_items = []
    for item in items:
        medicine_id = _coerce_int(item.get("medicine_id"))
        medicine = medicine_lookup.get(medicine_id, {})
        inventory_item = inventory_lookup.get(medicine_id) if medicine_id is not None else None
        stock_quantity = _coerce_int(inventory_item.get("stock_quantity")) if inventory_item else None
        has_stock = stock_quantity is not None and stock_quantity > 0
        enriched_items.append(
            {
                **item,
                "medicine_id": medicine_id,
                "catalog_unit": medicine.get("unit"),
                "unit_price": (
                    float(inventory_item.get("unit_price") or 0)
                    if inventory_item and has_stock
                    else None
                ),
                "pharmacy_stock": stock_quantity,
                "availability_message": (
                    "Available in your pharmacy inventory."
                    if inventory_item and has_stock
                    else (
                        "Listed in your inventory but currently out of stock."
                        if inventory_item
                        else (
                            "Prescription item is missing a medicine ID."
                            if medicine_id is None
                            else "This medicine is not stocked in your pharmacy."
                        )
                    )
                ),
            }
        )

    return {
        "prescription": _serialize_prescription_summary(
            prescription.data,
            **context,
        ),
        "items": enriched_items,
        "dispensations": _dispensing_history_entries(dispensing_rows),
        "note": "Clinical notes and encounter data are not available to pharmacy staff.",
    }


# ── Signature Verification (Bihanga B-4.1.2) ─────────────────────────────────

@router.get("/verify/{prescription_id}", dependencies=[Depends(PharmacistOnly)])
def verify_prescription(prescription_id: int):
    """
    Verifies the RSA-SHA256 digital signature of a prescription.
    Pharmacists MUST call this before dispensing medication.

    Returns:
        valid: True  → prescription is genuine, safe to dispense
        valid: False → prescription may be tampered, DO NOT dispense
    """

    prescription = execute_with_retry(
        lambda: (
            supabase_admin.table("prescriptions")
            .select("id, status, created_at, patient_id, doctor_id")
            .eq("id", prescription_id)
            .single()
            .execute()
            .data
        ),
        default=None,
    )

    if not prescription:
        raise HTTPException(status_code=404, detail="Prescription not found")

    return {
        "prescription_id": prescription_id,
        "valid": None,
        "status": "UNAVAILABLE",
        "message": (
            "Digital signature verification is unavailable in the active schema. "
            "The current prescriptions table does not expose signed payload columns yet."
        ),
        "safe_to_dispense": False,
        "doctor_id": prescription.get("doctor_id"),
        "patient_id": prescription.get("patient_id"),
    }


# ── Dispense Endpoint ─────────────────────────────────────────────────────────

@router.post("/dispense/{prescription_id}")
def dispense_prescription(
    prescription_id: str,
    payload: DispenseRequest,
    user: dict = Depends(PharmacistOnly)
):
    """Dispenses a prescription. Pharmacists only."""
    pharmacist_id     = user.get("user_id")
    items_to_dispense = payload.items
    pharmacy = _resolve_pharmacist_pharmacy(user, payload.pharmacy_id)
    pharmacy_id = pharmacy["id"]

    pres = execute_with_retry(
        lambda: (
            supabase_admin.table("prescriptions")
            .select("id, status, patient_id, doctor_id")
            .eq("id", prescription_id)
            .single()
            .execute()
        )
    )

    if not pres.data:
        raise HTTPException(404, "Prescription not found")

    if (pres.data["status"] or "").upper() == "DISPENSED":
        raise HTTPException(400, "Prescription already fully dispensed.")

    dispensing_line_items = []
    total_price = 0.0

    for item in items_to_dispense:
        item_id = item.id
        qty     = item.quantity

        db_item = execute_with_retry(
            lambda: (
                supabase_admin.table("prescription_items")
                .select("*")
                .eq("id", item_id)
                .eq("prescription_id", prescription_id)
                .single()
                .execute()
            )
        )

        if not db_item.data:
            raise HTTPException(404, f"Item {item_id} not found")

        prescribed_quantity = _prescribed_quantity(db_item.data)
        remaining = prescribed_quantity - (_coerce_int(db_item.data.get("dispensed_quantity")) or 0)

        if qty > remaining:
            raise HTTPException(400, f"Cannot dispense more than remaining ({remaining})")

        medicine_id = _coerce_int(db_item.data.get("medicine_id"))
        if medicine_id is None:
            raise HTTPException(400, f"Prescription item {item_id} is missing medicine_id")

        inventory_item = reduce_stock(medicine_id, pharmacy_id, qty)

        new_dispensed = (_coerce_int(db_item.data.get("dispensed_quantity")) or 0) + qty
        supabase_admin.table("prescription_items").update({
            "dispensed_quantity": new_dispensed
        }).eq("id", item_id).execute()

        medicine = _medicine_by_id(medicine_id)
        unit_price = _effective_server_unit_price(
            inventory_item.get("unit_price")
            or (medicine.get("retail_price") if medicine else 0)
            or 0,
            medicine,
            db_item.data,
        )
        line_total = unit_price * qty
        total_price += line_total
        dispensing_line_items.append(
            {
                "prescription_item_id": item_id,
                "quantity_dispensed": qty,
                "price": line_total,
            }
        )

    all_items  = execute_with_retry(
        lambda: (
            supabase_admin.table("prescription_items")
            .select("*")
            .eq("prescription_id", prescription_id)
            .execute()
        )
    )

    fully_done = all(
        (_coerce_int(item.get("dispensed_quantity")) or 0) >= _prescribed_quantity(item)
        for item in all_items.data
    )

    new_status = "DISPENSED" if fully_done else "PARTIALLY_DISPENSED"

    supabase_admin.table("prescriptions").update({
        "status": new_status
    }).eq("id", prescription_id).execute()

    dispensing_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("dispensing")
            .insert(
                {
                    "prescription_id": prescription_id,
                    "pharmacy_id": pharmacy_id,
                    "status": new_status.lower(),
                    "total_price": round(total_price, 2),
                }
            )
            .execute()
            .data
            or []
        ),
        default=list,
    )

    if dispensing_rows:
        dispensing_row = dispensing_rows[0]
        if dispensing_line_items:
            execute_with_retry(
                lambda: (
                    supabase_admin.table("dispensing_items")
                    .insert(
                        [
                            {
                                "dispensing_id": dispensing_row["id"],
                                **line_item,
                            }
                            for line_item in dispensing_line_items
                        ]
                    )
                    .execute()
                )
            )

    return {
        "message": "Dispensing successful",
        "status":  new_status
    }


# ── DHID Lookup ───────────────────────────────────────────────────────────────

@router.get("/dhid/{dhid}", dependencies=[Depends(PharmacistOnly)])
def get_prescriptions_by_dhid(dhid: str):
    """
    Looks up prescriptions by patient DHID.
    Pharmacists only.
    Returns pharmacy-safe fields only — no clinical notes (B-4.2.1)
    """
    if not validate_dhid(dhid):
        raise HTTPException(400, "Invalid DHID format")

    # Get patient_id from DHID first
    try:
        patient = (
            supabase_admin.table("patients")
            .select("id")
            .eq("dhid", dhid)
            .single()
            .execute()
            .data
        )
    except Exception:
        raise HTTPException(404, "Patient not found")

    if not patient:
        raise HTTPException(404, "Patient not found")

    prescriptions = execute_with_retry(
        lambda: (
            supabase_admin.table("prescriptions")
            .select("id, status, created_at, patient_id, doctor_id, encounter_id, valid_period")
            .eq("patient_id", patient["id"])
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    prescriptions = [row for row in prescriptions if _is_prescription_within_valid_period(row)]
    context = _build_prescription_context(prescriptions)
    return [
        _serialize_prescription_summary(row, **context)
        for row in prescriptions
    ]


@router.get("/history", dependencies=[Depends(PharmacistOnly)])
def get_dispense_history(user: dict = Depends(PharmacistOnly)):
    pharmacy = _resolve_pharmacist_pharmacy(user)

    dispensing_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("dispensing")
            .select("*")
            .eq("pharmacy_id", pharmacy["id"])
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    return _dispensing_history_entries(dispensing_rows)


@router.get("/inventory", dependencies=[Depends(PharmacistOnly)])
def get_pharmacist_inventory(user: dict = Depends(PharmacistOnly)):
    pharmacy = _resolve_pharmacist_pharmacy(user)
    rows = _inventory_rows_for_pharmacy(pharmacy["id"])
    medicine_lookup = _medicine_map(
        {row.get("medicine_id") for row in rows if row.get("medicine_id") is not None}
    )
    organisation = _organisation_map({pharmacy.get("organisation_id")}).get(
        pharmacy.get("organisation_id"),
        {},
    )

    return [
        {
            **row,
            "pharmacy_id": pharmacy.get("organisation_id"),
            "pharmacy_name": organisation.get("name"),
            "medicine_name": _inventory_display_name(row, medicine_lookup),
            "medicine_unit": medicine_lookup.get(row.get("medicine_id"), {}).get("unit"),
        }
        for row in rows
    ]


@router.patch("/profile", dependencies=[Depends(PharmacistOnly)])
def update_pharmacist_profile(
    payload: UpdatePharmacistProfileRequest,
    user: dict = Depends(PharmacistOnly),
):
    updated_rows = (
        supabase_admin.table("users")
        .update(
            {
                "pref_name": payload.preferred_name.strip(),
                "address": payload.address.strip(),
            }
        )
        .eq("id", user["user_id"])
        .execute()
        .data
        or []
    )
    if not updated_rows:
        raise HTTPException(status_code=404, detail="User profile not found.")

    return {
        "message": "Settings saved.",
        "user": build_user_context(user["user_id"], token=user.get("token")),
    }

# ── Bill Generation (Bihanga B-5.2.1) ────────────────────────────────────────
# unitPrice MUST come from server-side DB — never from client request
# This prevents price manipulation attacks

@router.post("/generate-bill", dependencies=[Depends(PharmacistOnly)])
def generate_bill(
    payload: BillRequest,
    current_user: dict = Depends(PharmacistOnly)
):
    """
    Generates a bill for dispensed medicines.
    Prices are ALWAYS fetched from server-side inventory DB.
    Client-submitted prices are completely ignored. (B-5.2.1)

    Attack prevented:
      Client sends unit_price: 0.01 → ignored
      Server fetches unit_price: 5.00 → used for billing
    """
    bill_lines  = []
    total_amount = 0.0
    pharmacy = _resolve_pharmacist_pharmacy(current_user, payload.pharmacy_id)
    pharmacy_id = _coerce_int(pharmacy.get("id"))

    for item in payload.items:

        # ── Fetch price from SERVER-SIDE DB ──────────────────────
        # Client cannot manipulate this price
        try:
            inventory_item = (
                supabase_admin.table("inventory")
                .select("id, medicine_id, unit_price, stock_quantity, pharmacy_id")
                .eq("id", item.inventory_id)
                .eq("pharmacy_id", pharmacy_id)
                .single()
                .execute()
                .data
            )
        except Exception:
            raise HTTPException(
                status_code=404,
                detail=f"Medicine ID {item.inventory_id} not found in this pharmacy's inventory"
            )

        if not inventory_item:
            raise HTTPException(
                status_code=404,
                detail=f"Medicine ID {item.inventory_id} not found"
            )

        medicine_lookup = _medicine_map(
            {inventory_item.get("medicine_id")} if inventory_item.get("medicine_id") else set()
        )
        medicine_name = _inventory_display_name(inventory_item, medicine_lookup)

        # ── Validate stock availability ───────────────────────────
        if inventory_item["stock_quantity"] < item.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock for {medicine_name}. "
                       f"Available: {inventory_item['stock_quantity']}, "
                       f"Requested: {item.quantity}"
            )

        # ── Calculate line total using SERVER price ───────────────
        # unit_price comes from DB — client has NO input here
        server_unit_price = _effective_server_unit_price(
            inventory_item.get("unit_price"),
            medicine_lookup.get(inventory_item.get("medicine_id")),
            inventory_item,
        )
        line_total        = server_unit_price * item.quantity

        bill_lines.append({
            "inventory_id":   item.inventory_id,
            "medicine_name":  medicine_name,
            "quantity":       item.quantity,
            "unit_price":     server_unit_price,   # ← always from DB
            "line_total":     line_total,
        })

        total_amount += line_total

    # ── Store bill in DB ──────────────────────────────────────────
    try:
        bill = supabase_admin.table("billing").insert({
            "prescription_id": payload.prescription_id,
            "pharmacy_id":     pharmacy_id,
            "pharmacist_id":   current_user.get("user_id"),
            "total_amount":    round(total_amount, 2),
            "status":          "pending",
            "created_at":      __import__("datetime").datetime.now().astimezone().isoformat(),
        }).execute().data
    except Exception:
        # Bill storage failure should not block returning the bill summary
        bill = None

    # ── Log the billing action ────────────────────────────────────
    try:
        supabase_admin.table("audit_logs").insert({
            "action":    "BILL_GENERATED",
            "entity":    "billing",
            "entity_id": bill[0]["id"] if bill else 0,
            "user_id":   current_user.get("user_id"),
            "timestamp": __import__("datetime").datetime.now().astimezone().isoformat(),
        }).execute()
    except Exception:
        pass

    return {
        "success":        True,
        "prescription_id": payload.prescription_id,
        "pharmacy_id":    pharmacy_id,
        "bill_lines":     bill_lines,
        "total_amount":   round(total_amount, 2),
        "currency":       "LKR",
        "note":           "All prices fetched from server-side inventory. "
                          "Client-submitted prices are not accepted.",
        "bill_id":        bill[0]["id"] if bill else None,
    }
