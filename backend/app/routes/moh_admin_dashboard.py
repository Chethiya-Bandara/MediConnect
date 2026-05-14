from collections import Counter
import json
from datetime import datetime, timedelta, timezone
import re
from typing import Any, Iterable

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.config.supabase import execute_with_retry, supabase_admin
from app.middleware.role_checker import HealthMinistryOnly, build_user_context
from app.middleware.performance import SLA_MS, get_slow_requests
from app.utils.gemini_client import call_gemini_assistant
from app.utils.helpers import hmac_nic, is_valid_nic, validate_dhid
from app.schemas.moh_admin_schema import (
    AdminUserStatusRequest,
    AnalyticsRequest,
    DoctorApprovalRequest,
    MedicineUpsertRequest,
    OrganizationApprovalRequest,
    OrganizationCreateRequest,
    SuspendRequest,
)


router = APIRouter(prefix="/moh-admin", tags=["moh-admin-dashboard"])
_ADMIN_APPROVAL_ROLES = {"hospital_admin", "pharmacy_admin", "health_ministry_admin"}
_ADMIN_APPROVAL_STATUSES = {"approved", "rejected", "pending", "suspended"}

_DIAGNOSIS_PATTERN = re.compile(r"Diagnosis:\s*(.+?)(?:\r?\n|$)", re.IGNORECASE)
_FULL_DHID_PATTERN = re.compile(r"^DHID-\d{4}-\d{4,5}$", re.IGNORECASE)


class PatientRegistryStatusRequest(BaseModel):
    user_id: str
    status: str


def _fetch_rows(table: str, select_clause: str = "*") -> list[dict[str, Any]]:
    return execute_with_retry(
        lambda: (
            supabase_admin.table(table).select(select_clause).execute().data or []
        ),
        default=[],
    )


def _fetch_rows_with_query(query_factory) -> list[dict[str, Any]]:
    return execute_with_retry(
        lambda: query_factory().execute().data or [],
        default=[],
    )


def _fetch_single_with_query(query_factory) -> dict[str, Any] | None:
    rows = _fetch_rows_with_query(query_factory)
    return rows[0] if rows else None


def _normalize_status(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    aliases = {
        "approve": "approved",
        "approved": "approved",
        "active": "approved",
        "reject": "rejected",
        "rejected": "rejected",
        "suspend": "suspended",
        "suspended": "suspended",
    }
    return aliases.get(normalized, normalized)


def _clean_medicine_text(value: str | None) -> str:
    return " ".join((value or "").replace("\xa0", " ").split())


def _title_status(value: str | None) -> str:
    normalized = _normalize_status(value)
    if not normalized:
        return "Unknown"
    return normalized.replace("_", " ").title()


def _title_account_status(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    if not normalized:
        return "Unknown"
    return normalized.replace("_", " ").title()


def _parse_diagnosis(notes: str | None) -> str | None:
    if not notes:
        return None
    match = _DIAGNOSIS_PATTERN.search(notes)
    if not match:
        return None
    diagnosis = match.group(1).strip()
    return diagnosis or None


def _build_user_lookup(user_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    values = [value for value in {value for value in user_ids if value}]
    if not values:
        return {}

    rows = _fetch_rows_with_query(
        lambda: supabase_admin.table("users")
        .select("id, email, role, name, pref_name, address, nic, status")
        .in_("id", values)
    )
    return {str(row["id"]): row for row in rows if row.get("id") is not None}


def _list_admin_approval_users() -> list[dict[str, Any]]:
    admin_profiles = _fetch_rows_with_query(
        lambda: supabase_admin.table("admin_profiles")
        .select("id, created_at, user_id, admin_role, organisation_id")
        .order("created_at", desc=True)
    )

    admin_profiles = [
        row
        for row in admin_profiles
        if _normalize_status(row.get("admin_role")) in _ADMIN_APPROVAL_ROLES
    ]
    user_lookup = _build_user_lookup(row.get("user_id") for row in admin_profiles)
    organisation_lookup = _build_organisation_lookup(
        row.get("organisation_id") for row in admin_profiles if row.get("organisation_id") is not None
    )

    items: list[dict[str, Any]] = []
    for row in admin_profiles:
        user = user_lookup.get(str(row.get("user_id")))
        if not user:
            continue

        role = _normalize_status(user.get("role"))
        if role not in _ADMIN_APPROVAL_ROLES:
            continue

        status_value = _normalize_status(user.get("status"))
        organisation = None
        organisation_id = row.get("organisation_id")
        try:
            if organisation_id is not None:
                organisation = organisation_lookup.get(int(organisation_id))
        except (TypeError, ValueError):
            organisation = None

        items.append(
            {
                "profile_id": row.get("id"),
                "user_id": str(user.get("id")),
                "email": user.get("email"),
                "name": user.get("name"),
                "preferred_name": user.get("pref_name") or user.get("name"),
                "role": user.get("role"),
                "admin_role": row.get("admin_role"),
                "organisation_id": organisation.get("id") if organisation else organisation_id,
                "organisation_name": organisation.get("name") if organisation else None,
                "status": status_value or user.get("status"),
                "created_at": row.get("created_at"),
            }
        )

    return items


def _organization_admin_profiles(organisation_id: int | str) -> list[dict[str, Any]]:
    return _fetch_rows_with_query(
        lambda: supabase_admin.table("admin_profiles")
        .select("id, user_id, admin_role, organisation_id")
        .eq("organisation_id", organisation_id)
    )


def _organization_pharmacists(organisation_id: int | str) -> list[dict[str, Any]]:
    pharmacies = _fetch_rows_with_query(
        lambda: supabase_admin.table("pharmacies")
        .select("id, organisation_id")
        .eq("organisation_id", organisation_id)
    )
    pharmacy_ids = [row.get("id") for row in pharmacies if row.get("id") is not None]
    if not pharmacy_ids:
        return []

    return _fetch_rows_with_query(
        lambda: supabase_admin.table("pharmacists")
        .select("id, user_id, pharmacy_id, status")
        .in_("pharmacy_id", pharmacy_ids)
    )


def _cascade_organisation_lockdown(
    organisation_id: int | str,
    next_user_status: str,
    current_user_id: str,
) -> None:
    related_admin_profiles = [
        row
        for row in _organization_admin_profiles(organisation_id)
        if _normalize_status(row.get("admin_role")) in {"hospital_admin", "pharmacy_admin"}
        and row.get("user_id")
    ]
    related_admin_user_ids = [row["user_id"] for row in related_admin_profiles]
    if related_admin_user_ids:
        execute_with_retry(
            lambda: supabase_admin.table("users")
            .update({"status": next_user_status})
            .in_("id", related_admin_user_ids)
            .execute()
        )
        for row in related_admin_profiles:
            profile_id = row.get("id")
            if profile_id is None:
                continue
            _log_audit_action(
                user_id=current_user_id,
                action=f"ADMIN_USER_{next_user_status.upper()}",
                entity="admin_profiles",
                entity_id=int(profile_id),
            )

    related_pharmacists = [row for row in _organization_pharmacists(organisation_id) if row.get("user_id")]
    related_pharmacist_user_ids = [row["user_id"] for row in related_pharmacists]
    if related_pharmacist_user_ids:
        execute_with_retry(
            lambda: supabase_admin.table("users")
            .update({"status": next_user_status})
            .in_("id", related_pharmacist_user_ids)
            .execute()
        )

    pharmacist_ids = [row.get("id") for row in related_pharmacists if row.get("id") is not None]
    if pharmacist_ids:
        execute_with_retry(
            lambda: supabase_admin.table("pharmacists")
            .update({"status": "suspended"})
            .in_("id", pharmacist_ids)
            .execute()
        )
        for pharmacist_id in pharmacist_ids:
            _log_audit_action(
                user_id=current_user_id,
                action=f"PHARMACIST_{next_user_status.upper()}",
                entity="pharmacists",
                entity_id=int(pharmacist_id),
            )


def _build_organisation_lookup(
    organisation_ids: Iterable[int | str],
) -> dict[int, dict[str, Any]]:
    normalized_ids: list[int] = []
    for value in organisation_ids:
        try:
            normalized_ids.append(int(value))
        except (TypeError, ValueError):
            continue

    ids = list({value for value in normalized_ids})
    if not ids:
        return {}

    rows = _fetch_rows_with_query(
        lambda: supabase_admin.table("organisations")
        .select("id, name, type, status, created_at")
        .in_("id", ids)
    )
    return {int(row["id"]): row for row in rows if row.get("id") is not None}


def _coerce_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _doctor_organisation_map_by_user(user_ids: Iterable[str]) -> dict[str, int]:
    values = [value for value in {value for value in user_ids if value}]
    if not values:
        return {}

    doctor_rows = _fetch_rows_with_query(
        lambda: supabase_admin.table("doctors")
        .select("id, user_id")
        .in_("user_id", values)
    )
    doctor_ids = [_coerce_int(row.get("id")) for row in doctor_rows]
    doctor_ids = [value for value in doctor_ids if value is not None]
    if not doctor_ids:
        return {}

    affiliation_rows = _fetch_rows_with_query(
        lambda: supabase_admin.table("doctor_affiliations")
        .select("doctor_id, hospital_id, status, created_at")
        .in_("doctor_id", doctor_ids)
        .order("created_at", desc=True)
    )
    approved_affiliations = [
        row for row in affiliation_rows if _normalize_status(row.get("status")) == "approved"
    ]
    hospital_ids = [
        _coerce_int(row.get("hospital_id")) for row in approved_affiliations if row.get("hospital_id") is not None
    ]
    hospital_ids = [value for value in hospital_ids if value is not None]
    if not hospital_ids:
        return {}

    hospital_rows = _fetch_rows_with_query(
        lambda: supabase_admin.table("hospitals")
        .select("id, organisation_id")
        .in_("id", hospital_ids)
    )
    hospital_to_org = {
        _coerce_int(row.get("id")): _coerce_int(row.get("organisation_id"))
        for row in hospital_rows
    }

    doctor_org_map: dict[int, int] = {}
    for row in approved_affiliations:
        doctor_id = _coerce_int(row.get("doctor_id"))
        hospital_id = _coerce_int(row.get("hospital_id"))
        organisation_id = hospital_to_org.get(hospital_id)
        if doctor_id is None or organisation_id is None or doctor_id in doctor_org_map:
            continue
        doctor_org_map[doctor_id] = organisation_id

    return {
        str(row["user_id"]): doctor_org_map[doctor_id]
        for row in doctor_rows
        if row.get("user_id") and (doctor_id := _coerce_int(row.get("id"))) in doctor_org_map
    }


def _pharmacist_organisation_map_by_user(user_ids: Iterable[str]) -> dict[str, int]:
    values = [value for value in {value for value in user_ids if value}]
    if not values:
        return {}

    pharmacist_rows = _fetch_rows_with_query(
        lambda: supabase_admin.table("pharmacists")
        .select("user_id, pharmacy_id")
        .in_("user_id", values)
    )
    pharmacy_ids = [
        _coerce_int(row.get("pharmacy_id")) for row in pharmacist_rows if row.get("pharmacy_id") is not None
    ]
    pharmacy_ids = [value for value in pharmacy_ids if value is not None]
    if not pharmacy_ids:
        return {}

    pharmacy_rows = _fetch_rows_with_query(
        lambda: supabase_admin.table("pharmacies")
        .select("id, organisation_id")
        .in_("id", pharmacy_ids)
    )
    pharmacy_to_org = {
        _coerce_int(row.get("id")): _coerce_int(row.get("organisation_id"))
        for row in pharmacy_rows
    }
    return {
        str(row["user_id"]): pharmacy_to_org[pharmacy_id]
        for row in pharmacist_rows
        if row.get("user_id") and (pharmacy_id := _coerce_int(row.get("pharmacy_id"))) in pharmacy_to_org
    }


def _admin_organisation_map_by_user(user_ids: Iterable[str]) -> dict[str, int]:
    values = [value for value in {value for value in user_ids if value}]
    if not values:
        return {}

    admin_rows = _fetch_rows_with_query(
        lambda: supabase_admin.table("admin_profiles")
        .select("user_id, organisation_id, created_at")
        .in_("user_id", values)
        .order("created_at", desc=True)
    )
    resolved: dict[str, int] = {}
    for row in admin_rows:
        user_id = row.get("user_id")
        organisation_id = _coerce_int(row.get("organisation_id"))
        if not user_id or organisation_id is None or user_id in resolved:
            continue
        resolved[str(user_id)] = organisation_id
    return resolved


def _build_actor_organisation_map(
    audit_rows: list[dict[str, Any]],
    user_lookup: dict[str, dict[str, Any]],
) -> dict[str, int]:
    actor_ids = [str(row.get("user_id")) for row in audit_rows if row.get("user_id")]
    doctor_map = _doctor_organisation_map_by_user(actor_ids)
    pharmacist_map = _pharmacist_organisation_map_by_user(actor_ids)
    admin_map = _admin_organisation_map_by_user(actor_ids)

    resolved: dict[str, int] = {}
    for actor_id in actor_ids:
        actor = user_lookup.get(actor_id) or {}
        role = _normalize_status(actor.get("role"))
        organisation_id = (
            doctor_map.get(actor_id)
            if role == "doctor"
            else pharmacist_map.get(actor_id)
            if role == "pharmacist"
            else admin_map.get(actor_id)
            if role in _ADMIN_APPROVAL_ROLES
            else None
        )
        if organisation_id is not None:
            resolved[actor_id] = organisation_id
    return resolved


def _build_audit_entity_organisation_map(audit_rows: list[dict[str, Any]]) -> dict[tuple[str, int], int]:
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
        rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("hospitals")
            .select("id, organisation_id")
            .in_("id", list(hospital_ids))
        )
        for row in rows:
            hospital_id = _coerce_int(row.get("id"))
            organisation_id = _coerce_int(row.get("organisation_id"))
            if hospital_id is not None and organisation_id is not None:
                resolved[("hospitals", hospital_id)] = organisation_id

    pharmacy_ids = entity_ids_by_type.get("pharmacies", set())
    if pharmacy_ids:
        rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("pharmacies")
            .select("id, organisation_id")
            .in_("id", list(pharmacy_ids))
        )
        for row in rows:
            pharmacy_id = _coerce_int(row.get("id"))
            organisation_id = _coerce_int(row.get("organisation_id"))
            if pharmacy_id is not None and organisation_id is not None:
                resolved[("pharmacies", pharmacy_id)] = organisation_id

    appointment_ids = entity_ids_by_type.get("appointments", set())
    if appointment_ids:
        rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("appointments")
            .select("id, organisation_id")
            .in_("id", list(appointment_ids))
        )
        for row in rows:
            appointment_id = _coerce_int(row.get("id"))
            organisation_id = _coerce_int(row.get("organisation_id"))
            if appointment_id is not None and organisation_id is not None:
                resolved[("appointments", appointment_id)] = organisation_id

    encounter_ids = entity_ids_by_type.get("encounters", set())
    encounter_to_appointment: dict[int, int] = {}
    if encounter_ids:
        rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("encounters")
            .select("id, appointment_id")
            .in_("id", list(encounter_ids))
        )
        encounter_to_appointment = {
            encounter_id: appointment_id
            for row in rows
            if (encounter_id := _coerce_int(row.get("id"))) is not None
            and (appointment_id := _coerce_int(row.get("appointment_id"))) is not None
        }
        missing_appointments = {
            appointment_id
            for appointment_id in encounter_to_appointment.values()
            if ("appointments", appointment_id) not in resolved
        }
        if missing_appointments:
            rows = _fetch_rows_with_query(
                lambda: supabase_admin.table("appointments")
                .select("id, organisation_id")
                .in_("id", list(missing_appointments))
            )
            for row in rows:
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
        doctor_rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("doctor_affiliations")
            .select("doctor_id, hospital_id, status, created_at")
            .in_("doctor_id", list(doctor_ids))
            .order("created_at", desc=True)
        )
        approved_rows = [
            row for row in doctor_rows if _normalize_status(row.get("status")) == "approved"
        ]
        hospital_ids = {
            hospital_id
            for row in approved_rows
            if (hospital_id := _coerce_int(row.get("hospital_id"))) is not None
        }
        hospital_rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("hospitals")
            .select("id, organisation_id")
            .in_("id", list(hospital_ids))
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

    pharmacist_ids = entity_ids_by_type.get("pharmacists", set())
    if pharmacist_ids:
        pharmacist_rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("pharmacists")
            .select("id, pharmacy_id")
            .in_("id", list(pharmacist_ids))
        )
        pharmacy_ids = {
            pharmacy_id
            for row in pharmacist_rows
            if (pharmacy_id := _coerce_int(row.get("pharmacy_id"))) is not None
        }
        pharmacy_rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("pharmacies")
            .select("id, organisation_id")
            .in_("id", list(pharmacy_ids))
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
        rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("admin_profiles")
            .select("id, organisation_id")
            .in_("id", list(admin_profile_ids))
        )
        for row in rows:
            profile_id = _coerce_int(row.get("id"))
            organisation_id = _coerce_int(row.get("organisation_id"))
            if profile_id is not None and organisation_id is not None:
                resolved[("admin_profiles", profile_id)] = organisation_id

    prescription_ids = entity_ids_by_type.get("prescriptions", set())
    prescription_to_encounter: dict[int, int] = {}
    if prescription_ids:
        rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("prescriptions")
            .select("id, encounter_id")
            .in_("id", list(prescription_ids))
        )
        prescription_to_encounter = {
            prescription_id: encounter_id
            for row in rows
            if (prescription_id := _coerce_int(row.get("id"))) is not None
            and (encounter_id := _coerce_int(row.get("encounter_id"))) is not None
        }

    prescription_item_ids = entity_ids_by_type.get("prescription_items", set())
    if prescription_item_ids:
        rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("prescription_items")
            .select("id, prescription_id")
            .in_("id", list(prescription_item_ids))
        )
        missing_prescriptions = set()
        for row in rows:
            item_id = _coerce_int(row.get("id"))
            prescription_id = _coerce_int(row.get("prescription_id"))
            if item_id is None or prescription_id is None:
                continue
            if prescription_id not in prescription_to_encounter:
                missing_prescriptions.add(prescription_id)
            resolved[("prescription_items", item_id)] = prescription_id
        if missing_prescriptions:
            rows = _fetch_rows_with_query(
                lambda: supabase_admin.table("prescriptions")
                .select("id, encounter_id")
                .in_("id", list(missing_prescriptions))
            )
            for row in rows:
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
    dispensing_to_org: dict[int, int] = {}
    if dispensing_ids:
        rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("dispensing")
            .select("id, pharmacy_id")
            .in_("id", list(dispensing_ids))
        )
        pharmacy_ids = {
            pharmacy_id
            for row in rows
            if (pharmacy_id := _coerce_int(row.get("pharmacy_id"))) is not None
        }
        pharmacy_rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("pharmacies")
            .select("id, organisation_id")
            .in_("id", list(pharmacy_ids))
        ) if pharmacy_ids else []
        pharmacy_to_org = {
            _coerce_int(row.get("id")): _coerce_int(row.get("organisation_id"))
            for row in pharmacy_rows
        }
        for row in rows:
            dispensing_id = _coerce_int(row.get("id"))
            pharmacy_id = _coerce_int(row.get("pharmacy_id"))
            organisation_id = pharmacy_to_org.get(pharmacy_id)
            if dispensing_id is not None and organisation_id is not None:
                dispensing_to_org[dispensing_id] = organisation_id
                resolved[("dispensing", dispensing_id)] = organisation_id

    dispensing_item_ids = entity_ids_by_type.get("dispensing_items", set())
    if dispensing_item_ids:
        rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("dispensing_items")
            .select("id, dispensing_id")
            .in_("id", list(dispensing_item_ids))
        )
        for row in rows:
            item_id = _coerce_int(row.get("id"))
            dispensing_id = _coerce_int(row.get("dispensing_id"))
            organisation_id = dispensing_to_org.get(dispensing_id)
            if item_id is not None and organisation_id is not None:
                resolved[("dispensing_items", item_id)] = organisation_id

    return {
        key: organisation_id
        for key, organisation_id in resolved.items()
        if organisation_id is not None
    }


def _log_audit_action(
    *,
    user_id: str,
    action: str,
    entity: str,
    entity_id: int,
):
    payload = {
        "action": action,
        "entity": entity,
        "entity_id": entity_id,
        "user_id": user_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    try:
        execute_with_retry(
            lambda: supabase_admin.table("audit_logs").insert(payload).execute(),
            attempts=2,
        )
    except Exception:
        # Audit logging should not block the primary ministry workflow.
        pass


def _list_all_organisations() -> list[dict[str, Any]]:
    organisations = _fetch_rows_with_query(
        lambda: supabase_admin.table("organisations")
        .select("id, name, type, status, created_at")
        .order("created_at", desc=True)
    )

    organisation_ids = [row.get("id") for row in organisations if row.get("id") is not None]
    hospital_rows = _fetch_rows_with_query(
        lambda: supabase_admin.table("hospitals")
        .select("id, organisation_id")
        .in_("organisation_id", organisation_ids)
    ) if organisation_ids else []
    pharmacy_rows = _fetch_rows_with_query(
        lambda: supabase_admin.table("pharmacies")
        .select("id, organisation_id")
        .in_("organisation_id", organisation_ids)
    ) if organisation_ids else []

    hospital_lookup = {
        int(row["organisation_id"]): int(row["id"])
        for row in hospital_rows
        if row.get("organisation_id") is not None and row.get("id") is not None
    }
    pharmacy_lookup = {
        int(row["organisation_id"]): int(row["id"])
        for row in pharmacy_rows
        if row.get("organisation_id") is not None and row.get("id") is not None
    }

    items: list[dict[str, Any]] = []
    for row in organisations:
        organisation_id = row.get("id")
        try:
            organisation_id_int = int(organisation_id)
        except (TypeError, ValueError):
            continue

        linked_table = None
        linked_record_id = None
        if organisation_id_int in hospital_lookup:
            linked_table = "hospitals"
            linked_record_id = hospital_lookup[organisation_id_int]
        elif organisation_id_int in pharmacy_lookup:
            linked_table = "pharmacies"
            linked_record_id = pharmacy_lookup[organisation_id_int]

        items.append(
            {
                "id": organisation_id_int,
                "name": row.get("name"),
                "type": row.get("type"),
                "status": row.get("status"),
                "created_at": row.get("created_at"),
                "linked_table": linked_table,
                "linked_record_id": linked_record_id,
            }
        )

    return items


def _list_all_medicines(search: str | None = None) -> list[dict[str, Any]]:
    normalized_search = _clean_medicine_text(search)
    medicine_rows = _fetch_rows_with_query(
        lambda: (
            supabase_admin.table("medicines")
            .select("id, created_at, name, unit, wholesale_price, retail_price, status")
            .neq("status", "deactivated")
            .ilike("name", f"%{normalized_search}%")
            .order("name")
        )
        if normalized_search
        else (
            supabase_admin.table("medicines")
            .select("id, created_at, name, unit, wholesale_price, retail_price, status")
            .neq("status", "deactivated")
            .order("name")
        )
    )

    inventory_rows = _fetch_rows_with_query(
        lambda: supabase_admin.table("inventory").select("medicine_id")
    )
    inventory_counter = Counter()
    for row in inventory_rows:
        try:
            inventory_counter[int(row.get("medicine_id"))] += 1
        except (TypeError, ValueError):
            continue

    items: list[dict[str, Any]] = []
    for row in medicine_rows:
        try:
            medicine_id = int(row["id"])
        except (TypeError, ValueError, KeyError):
            continue

        items.append(
            {
                "id": medicine_id,
                "created_at": row.get("created_at"),
                "name": _clean_medicine_text(row.get("name")),
                "unit": _clean_medicine_text(row.get("unit")),
                "wholesale_price": row.get("wholesale_price"),
                "retail_price": row.get("retail_price"),
                "inventory_links": inventory_counter.get(medicine_id, 0),
            }
        )

    return items


def _get_organisation_registry_item(organisation_id: int) -> dict[str, Any]:
    organisation = _fetch_single_with_query(
        lambda: supabase_admin.table("organisations")
        .select("id, name, type, status")
        .eq("id", organisation_id)
    )
    if not organisation:
        raise HTTPException(status_code=404, detail="Organisation not found.")
    return organisation




def _get_medicine_or_404(medicine_id: int) -> dict[str, Any]:
    medicine = _fetch_single_with_query(
        lambda: supabase_admin.table("medicines")
        .select("id, created_at, name, unit, wholesale_price, retail_price")
        .eq("id", medicine_id)
    )
    if not medicine:
        raise HTTPException(status_code=404, detail="Medicine not found.")
    return medicine


def _ensure_unique_medicine_name(name: str, exclude_id: int | None = None):
    candidates = _fetch_rows_with_query(
        lambda: supabase_admin.table("medicines")
        .select("id, name")
        .ilike("name", name)
        .limit(25)
    )
    normalized_name = _clean_medicine_text(name).lower()
    for row in candidates:
        try:
            row_id = int(row["id"])
        except (TypeError, ValueError, KeyError):
            continue
        if exclude_id is not None and row_id == exclude_id:
            continue
        if _clean_medicine_text(row.get("name")).lower() == normalized_name:
            raise HTTPException(
                status_code=409,
                detail="A medicine with this name already exists in the registry.",
            )


def _get_encounter_rows(
    *,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict[str, Any]]:
    def build_query():
        query = supabase_admin.table("encounters").select("id, created_at, notes")
        if start_date:
            query = query.gte("created_at", f"{start_date}T00:00:00")
        if end_date:
            query = query.lte("created_at", f"{end_date}T23:59:59.999999")
        return query.order("created_at", desc=True)

    return _fetch_rows_with_query(build_query)


def _build_diagnosis_counter(
    *,
    start_date: str | None = None,
    end_date: str | None = None,
) -> Counter[str]:
    encounters = _get_encounter_rows(start_date=start_date, end_date=end_date)
    counter: Counter[str] = Counter()
    for row in encounters:
        diagnosis = _parse_diagnosis(row.get("notes"))
        if diagnosis:
            counter[diagnosis] += 1
    return counter


def _monthly_report_fallback(report_input: dict[str, Any]) -> str:
    top_diagnoses = report_input.get("top_diagnoses") or []
    top_summary = (
        ", ".join(f"{item['label']} ({item['count']})" for item in top_diagnoses[:5])
        if top_diagnoses
        else "No diagnosis-coded encounter notes were recorded in the selected period."
    )
    anomalies = report_input.get("anomalies") or {}
    performance = report_input.get("performance") or {}

    return (
        "Monthly national health summary\n\n"
        f"Generated for: {report_input.get('generated_for')}\n"
        f"Generated at: {report_input.get('generated_at')}\n\n"
        f"Registered organisations: {report_input.get('registered_organisations')}\n"
        f"Approved or active organisations: {report_input.get('approved_organisations')}\n"
        f"Pending organisations: {report_input.get('pending_organisations')}\n"
        f"Registered doctors: {report_input.get('registered_doctors')}\n"
        f"Approved or active doctors: {report_input.get('approved_doctors')}\n"
        f"Pending doctors: {report_input.get('pending_doctors')}\n"
        f"Registered patients: {report_input.get('registered_patients')}\n"
        f"Encounters in the last 30 days: {report_input.get('encounters_last_30_days')}\n"
        f"Top diagnosis signals from encounter notes: {top_summary}\n"
        f"Open anomaly flags: {anomalies.get('open_count', 0)} of {anomalies.get('total_count', 0)} total\n"
        f"Slow requests above SLA: {performance.get('slow_request_count', 0)} over {performance.get('sla_ms', SLA_MS)} ms\n"
        f"Audit events in the last 24 hours: {report_input.get('audit_events_last_24_hours')}\n\n"
        "District-level slicing is currently limited because the live schema does not expose a district column for encounter diagnosis data."
    )


def _structured_monthly_report_fallback(report_input: dict[str, Any]) -> dict[str, Any]:
    top_diagnoses = report_input.get("top_diagnoses") or []
    anomalies = report_input.get("anomalies") or {}
    performance = report_input.get("performance") or {}
    open_anomalies = int(anomalies.get("open_count", 0) or 0)
    total_anomalies = int(anomalies.get("total_count", 0) or 0)
    slow_request_count = int(performance.get("slow_request_count", 0) or 0)
    sla_ms = int(performance.get("sla_ms", SLA_MS) or SLA_MS)
    leading_diagnosis = top_diagnoses[0]["label"] if top_diagnoses else "No diagnosis signal recorded"
    leading_diagnosis_count = top_diagnoses[0]["count"] if top_diagnoses else 0

    risk_items = [
        f"{open_anomalies} open anomaly flag(s) remain unresolved out of {total_anomalies} total reviewed flags.",
        f"{slow_request_count} request(s) exceeded the {sla_ms} ms SLA threshold in the latest performance sample.",
    ]
    if not top_diagnoses:
        risk_items.append(
            "Diagnosis trend quality is limited because no coded diagnosis signal was extracted from recent encounter notes."
        )

    recommendations = [
        "Review open anomaly flags and close or escalate high-frequency events before the next reporting cycle.",
        "Investigate slow-request hotspots and prioritise the noisiest backend paths against the SLA target.",
    ]
    if top_diagnoses:
        recommendations.append(
            f"Monitor the leading diagnosis signal, {leading_diagnosis}, and verify whether the recent rise reflects demand or data-entry concentration."
        )
    else:
        recommendations.append(
            "Improve diagnosis note structure so monthly reporting can produce stronger trend analysis."
        )

    return {
        "title": "Monthly National Health Summary",
        "subtitle": "Ministry analytics and operations brief",
        "generated_for": report_input.get("generated_for"),
        "generated_at": report_input.get("generated_at"),
        "reporting_window": "Last 30 days",
        "executive_summary": [
            f"{report_input.get('registered_patients', 0)} registered patients, {report_input.get('registered_doctors', 0)} registered doctors, and {report_input.get('registered_organisations', 0)} registered organisations are currently reflected in the ministry view.",
            f"The strongest diagnosis signal in recent encounter notes is {leading_diagnosis} with {leading_diagnosis_count} recorded case(s).",
            f"The system logged {report_input.get('audit_events_last_24_hours', 0)} audit event(s) in the last 24 hours.",
        ],
        "key_metrics": [
            {"label": "Registered Organisations", "value": str(report_input.get("registered_organisations", 0))},
            {"label": "Approved / Active Organisations", "value": str(report_input.get("approved_organisations", 0))},
            {"label": "Pending Organisations", "value": str(report_input.get("pending_organisations", 0))},
            {"label": "Registered Doctors", "value": str(report_input.get("registered_doctors", 0))},
            {"label": "Approved / Active Doctors", "value": str(report_input.get("approved_doctors", 0))},
            {"label": "Pending Doctors", "value": str(report_input.get("pending_doctors", 0))},
            {"label": "Registered Patients", "value": str(report_input.get("registered_patients", 0))},
            {"label": "Encounters in Last 30 Days", "value": str(report_input.get("encounters_last_30_days", 0))},
            {"label": "Audit Events in Last 24 Hours", "value": str(report_input.get("audit_events_last_24_hours", 0))},
        ],
        "top_diagnoses": top_diagnoses,
        "operational_highlights": [
            f"{report_input.get('approved_organisations', 0)} organisation(s) are currently approved or active.",
            f"{report_input.get('approved_doctors', 0)} doctor account(s) are currently approved or active.",
            f"{report_input.get('encounters_last_30_days', 0)} encounter(s) were recorded during the reporting window.",
        ],
        "risk_items": risk_items,
        "recommendations": recommendations,
        "data_limitations": report_input.get("data_limitations") or [],
        "narrative_text": _monthly_report_fallback(report_input),
    }


def _extract_json_object(raw_text: str) -> dict[str, Any] | None:
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned.replace("json\n", "", 1).replace("json\r\n", "", 1)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _generate_monthly_ai_report_structure(report_input: dict[str, Any]) -> dict[str, Any] | None:
    prompt = (
        "Return a strict JSON object for a ministry monthly report. "
        "Use only the provided data. Do not include markdown or commentary outside JSON. "
        "JSON keys must be: executive_summary, operational_highlights, risk_items, recommendations. "
        "Each value must be an array of 2 to 4 concise bullet strings for an internal ministry audience."
    )
    answer, issue = call_gemini_assistant(
        {
            "message": prompt,
            "history": [],
            "moh_admin_context": report_input,
        }
    )
    _ = issue
    if not answer:
        return None

    parsed = _extract_json_object(answer)
    if not parsed:
        return None

    normalized: dict[str, list[str]] = {}
    for key in ("executive_summary", "operational_highlights", "risk_items", "recommendations"):
        values = parsed.get(key)
        if not isinstance(values, list):
            return None
        cleaned_items = [
            " ".join(str(item).split())
            for item in values
            if isinstance(item, str) and item.strip()
        ][:4]
        if not cleaned_items:
            return None
        normalized[key] = cleaned_items

    return normalized


def _generate_monthly_ai_report(report_input: dict[str, Any]) -> str | None:
    prompt = (
        "Generate a monthly MOH admin report that summarizes the provided national health statistics. "
        "Use only the provided data. Include: 1) executive summary, 2) operational highlights, "
        "3) diagnosis trend signals, 4) risk/watch items, and 5) data limitations. "
        "Keep it concise, factual, and useful for an internal ministry admin audience."
    )
    answer, issue = call_gemini_assistant(
        {
            "message": prompt,
            "history": [],
            "moh_admin_context": report_input,
        }
    )
    if answer:
        return answer.strip()
    _ = issue
    return None


class UpdateHealthMinistryAdminProfileRequest(BaseModel):
    preferred_name: str
    address: str


@router.get("/dashboard")
def get_dashboard(current_user: dict = Depends(HealthMinistryOnly)):
    organisations = _list_all_organisations()
    doctors = _fetch_rows_with_query(
        lambda: supabase_admin.table("doctors")
        .select("id, created_at, specialization, user_id, slmc_number, status")
        .order("created_at", desc=True)
    )
    admin_users = _list_admin_approval_users()
    patients = _fetch_rows("patients", "id")

    now_utc = datetime.now(timezone.utc)
    recent_threshold = (now_utc - timedelta(hours=24)).isoformat()
    audit_rows = _fetch_rows_with_query(
        lambda: supabase_admin.table("audit_logs")
        .select("id, timestamp, user_id, action, entity, entity_id")
        .gte("timestamp", recent_threshold)
        .order("timestamp", desc=True)
        .limit(100)
    )

    all_audit_rows = _fetch_rows_with_query(
        lambda: supabase_admin.table("audit_logs")
        .select("id, timestamp, user_id, action, entity, entity_id")
        .order("timestamp", desc=True)
        .limit(100)
    )

    user_lookup = _build_user_lookup(
        [row.get("user_id") for row in doctors]
        + [row.get("user_id") for row in all_audit_rows]
        + [row.get("user_id") for row in admin_users]
    )

    pending_organisations = [
        row for row in organisations if _normalize_status(row.get("status")) == "pending"
    ]
    pending_doctors: list[dict[str, Any]] = []
    for doctor in doctors:
        if _normalize_status(doctor.get("status")) != "pending":
            continue
        user = user_lookup.get(str(doctor.get("user_id")))
        pending_doctors.append(
            {
                "doctor_id": doctor.get("id"),
                "user_id": doctor.get("user_id"),
                "name": user.get("name") if user else None,
                "preferred_name": user.get("pref_name") if user else None,
                "email": user.get("email") if user else None,
                "specialization": doctor.get("specialization"),
                "slmc_number": doctor.get("slmc_number"),
                "status": doctor.get("status"),
                "created_at": doctor.get("created_at"),
            }
        )

    admin_approval_items = [
        item
        for item in admin_users
        if _normalize_status(item.get("status")) in {"pending", "approved", "rejected", "suspended"}
    ]
    pending_admin_count = sum(
        1 for item in admin_approval_items if _normalize_status(item.get("status")) == "pending"
    )

    actor_organisation_map = _build_actor_organisation_map(all_audit_rows, user_lookup)
    entity_organisation_map = _build_audit_entity_organisation_map(all_audit_rows)
    organisation_lookup = _build_organisation_lookup(
        list(actor_organisation_map.values()) + list(entity_organisation_map.values())
    )
    audit_logs: list[dict[str, Any]] = []
    for row in all_audit_rows:
        actor = user_lookup.get(str(row.get("user_id")))
        entity = str(row.get("entity") or "").strip().lower()
        entity_id = _coerce_int(row.get("entity_id"))
        organisation_id = (
            entity_organisation_map.get((entity, entity_id))
            if entity_id is not None
            else None
        )
        if organisation_id is None and row.get("user_id"):
            organisation_id = actor_organisation_map.get(str(row.get("user_id")))
        organisation = organisation_lookup.get(organisation_id) if organisation_id is not None else None

        audit_logs.append(
            {
                "id": row.get("id"),
                "timestamp": row.get("timestamp"),
                "actor_id": row.get("user_id"),
                "actor_name": (actor.get("pref_name") or actor.get("name")) if actor else None,
                "actor_role": actor.get("role") if actor else None,
                "organisation_id": organisation_id,
                "organisation_name": organisation.get("name") if organisation else None,
                "action": row.get("action"),
                "details": (
                    f"{row.get('entity', 'entity')} #{row.get('entity_id')}"
                    if row.get("entity_id") is not None
                    else row.get("entity")
                ),
            }
        )

    return {
        "stats": {
            "total_organisations": len(organisations),
            "pending_organisations": len(pending_organisations),
            "total_doctors": len(doctors),
            "pending_doctors": len(pending_doctors),
            "pending_admins": pending_admin_count,
            "total_patients": len(patients),
            "audit_events_24h": len(audit_rows),
        },
        "pending_organisations": pending_organisations,
        "pending_doctors": pending_doctors,
        "pending_admins": admin_approval_items,
        "audit_logs": audit_logs,
        "viewer": {
            "user_id": current_user.get("user_id"),
            "role": current_user.get("role"),
        },
    }


@router.patch("/profile")
def update_health_ministry_admin_profile(
    data: UpdateHealthMinistryAdminProfileRequest,
    current_user: dict = Depends(HealthMinistryOnly),
):
    preferred_name = (data.preferred_name or "").strip()
    address = (data.address or "").strip()
    if len(preferred_name) < 2 or len(address) < 5:
        raise HTTPException(status_code=400, detail="Preferred name and address are required.")

    updated_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("users")
            .update(
                {
                    "pref_name": preferred_name,
                    "address": address,
                }
            )
            .eq("id", current_user["user_id"])
            .execute()
            .data
            or []
        ),
        default=[],
    )
    if not updated_rows:
        raise HTTPException(status_code=404, detail="User profile not found.")

    _log_audit_action(
        user_id=current_user["user_id"],
        action="MINISTRY_ADMIN_PROFILE_UPDATED",
        entity="users",
        entity_id=0,
    )

    return {
        "message": "Settings saved.",
        "user": build_user_context(current_user["user_id"], token=current_user.get("token")),
    }


@router.get("/organisations")
def list_organisations(current_user: dict = Depends(HealthMinistryOnly)):
    _ = current_user
    items = _list_all_organisations()
    return {
        "items": items,
        "count": len(items),
    }


@router.post("/organisations")
def create_organisation(
    payload: OrganizationCreateRequest,
    current_user: dict = Depends(HealthMinistryOnly),
):
    organisation_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("organisations")
            .insert(
                {
                    "name": payload.name.strip(),
                    "type": payload.type.strip().lower(),
                    "status": payload.status.strip().lower(),
                }
            )
            .execute()
            .data
            or []
        )
    )
    if not organisation_rows:
        raise HTTPException(status_code=500, detail="Organisation could not be created.")

    organisation = organisation_rows[0]
    organisation_id = int(organisation["id"])
    normalized_type = _normalize_status(payload.type)

    if normalized_type == "hospital":
        execute_with_retry(
            lambda: supabase_admin.table("hospitals")
            .insert({"organisation_id": organisation_id})
            .execute()
        )
    elif normalized_type == "pharmacy":
        execute_with_retry(
            lambda: supabase_admin.table("pharmacies")
            .insert({"organisation_id": organisation_id})
            .execute()
        )

    _log_audit_action(
        user_id=current_user["user_id"],
        action="ORGANISATION_CREATED",
        entity="organisations",
        entity_id=organisation_id,
    )

    return {
        "message": f"{payload.name.strip()} created.",
        "item": {
            "id": organisation_id,
            "name": organisation.get("name"),
            "type": organisation.get("type"),
            "status": organisation.get("status"),
            "created_at": organisation.get("created_at"),
        },
    }


@router.get("/medicines")
def list_medicines(
    search: str = Query(default=""),
    current_user: dict = Depends(HealthMinistryOnly),
):
    _ = current_user
    items = _list_all_medicines(search=search)
    return {
        "items": items,
        "count": len(items),
    }


@router.post("/medicines")
def create_medicine(
    payload: MedicineUpsertRequest,
    current_user: dict = Depends(HealthMinistryOnly),
):
    cleaned_name = _clean_medicine_text(payload.name)
    cleaned_unit = _clean_medicine_text(payload.unit).upper()
    _ensure_unique_medicine_name(cleaned_name)

    medicine_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("medicines")
            .insert(
                {
                    "name": cleaned_name,
                    "unit": cleaned_unit,
                    "wholesale_price": payload.wholesale_price,
                    "retail_price": payload.retail_price,
                }
            )
            .execute()
            .data
            or []
        ),
        default=[],
    )
    if not medicine_rows:
        raise HTTPException(status_code=500, detail="Medicine could not be created.")

    medicine = medicine_rows[0]
    medicine_id = int(medicine["id"])
    _log_audit_action(
        user_id=current_user["user_id"],
        action="MEDICINE_CREATED",
        entity="medicines",
        entity_id=medicine_id,
    )

    return {
        "message": f"{cleaned_name} added to the national medicine registry.",
        "item": {
            "id": medicine_id,
            "created_at": medicine.get("created_at"),
            "name": cleaned_name,
            "unit": cleaned_unit,
            "wholesale_price": medicine.get("wholesale_price"),
            "retail_price": medicine.get("retail_price"),
            "inventory_links": 0,
        },
    }


@router.put("/medicines/{medicine_id}")
def update_medicine(
    medicine_id: int,
    payload: MedicineUpsertRequest,
    current_user: dict = Depends(HealthMinistryOnly),
):
    _get_medicine_or_404(medicine_id)
    cleaned_name = _clean_medicine_text(payload.name)
    cleaned_unit = _clean_medicine_text(payload.unit).upper()
    _ensure_unique_medicine_name(cleaned_name, exclude_id=medicine_id)

    updated_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("medicines")
            .update(
                {
                    "name": cleaned_name,
                    "unit": cleaned_unit,
                    "wholesale_price": payload.wholesale_price,
                    "retail_price": payload.retail_price,
                }
            )
            .eq("id", medicine_id)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    if not updated_rows:
        raise HTTPException(status_code=500, detail="Medicine could not be updated.")

    _log_audit_action(
        user_id=current_user["user_id"],
        action="MEDICINE_UPDATED",
        entity="medicines",
        entity_id=medicine_id,
    )
    return {"message": f"{cleaned_name} updated."}


@router.delete("/medicines/{medicine_id}")
def delete_medicine(
    medicine_id: int,
    current_user: dict = Depends(HealthMinistryOnly),
):
    raise HTTPException(
        status_code=405,
        detail=(
            "Direct deletion is disabled. Use POST /moh-admin/deletion-requests "
            "with entity_type='medicine' to initiate the dual-admin approval workflow."
        ),
    )


@router.delete("/organisations/{organisation_id}")
def delete_organisation(
    organisation_id: int,
    current_user: dict = Depends(HealthMinistryOnly),
):
    raise HTTPException(
        status_code=405,
        detail=(
            "Direct deletion is disabled. Use POST /moh-admin/deletion-requests "
            "with entity_type='organisation' to initiate the dual-admin approval workflow."
        ),
    )


@router.delete("/hospitals/{hospital_id}")
def delete_hospital(
    hospital_id: int,
    current_user: dict = Depends(HealthMinistryOnly),
):
    raise HTTPException(
        status_code=405,
        detail=(
            "Direct deletion is disabled. Use POST /moh-admin/deletion-requests "
            "with entity_type='hospital' to initiate the dual-admin approval workflow."
        ),
    )


@router.delete("/pharmacies/{pharmacy_id}")
def delete_pharmacy(
    pharmacy_id: int,
    current_user: dict = Depends(HealthMinistryOnly),
):
    raise HTTPException(
        status_code=405,
        detail=(
            "Direct deletion is disabled. Use POST /moh-admin/deletion-requests "
            "with entity_type='pharmacy' to initiate the dual-admin approval workflow."
        ),
    )


@router.delete("/patients/{patient_id}")
def delete_patient(
    patient_id: int,
    current_user: dict = Depends(HealthMinistryOnly),
):
    raise HTTPException(
        status_code=405,
        detail=(
            "Direct deletion is disabled. Use POST /moh-admin/deletion-requests "
            "with entity_type='patient' to initiate the dual-admin approval workflow."
        ),
    )


@router.put("/organizations/approve")
def approve_organization(
    data: OrganizationApprovalRequest,
    current_user: dict = Depends(HealthMinistryOnly),
):
    organisation = _fetch_single_with_query(
        lambda: supabase_admin.table("organisations")
        .select("id, name, status")
        .eq("id", data.id)
    )
    if not organisation:
        raise HTTPException(status_code=404, detail="Organisation not found.")

    execute_with_retry(
        lambda: supabase_admin.table("organisations")
        .update({"status": data.status})
        .eq("id", data.id)
        .execute()
    )
    normalized_status = _normalize_status(data.status)
    if normalized_status in {"rejected", "suspended"}:
        _cascade_organisation_lockdown(data.id, normalized_status, current_user["user_id"])
    _log_audit_action(
        user_id=current_user["user_id"],
        action=f"ORGANISATION_{data.status.upper()}",
        entity="organisations",
        entity_id=int(data.id),
    )

    return {"message": f"Organisation marked as {_title_status(data.status)}."}


@router.put("/doctors/approve")
def approve_doctor(
    data: DoctorApprovalRequest,
    current_user: dict = Depends(HealthMinistryOnly),
):
    doctor = _fetch_single_with_query(
        lambda: supabase_admin.table("doctors")
        .select("id, status")
        .eq("id", data.id)
    )
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found.")

    execute_with_retry(
        lambda: supabase_admin.table("doctors")
        .update({"status": data.status})
        .eq("id", data.id)
        .execute()
    )
    _log_audit_action(
        user_id=current_user["user_id"],
        action=f"DOCTOR_{data.status.upper()}",
        entity="doctors",
        entity_id=int(data.id),
    )

    return {"message": f"Doctor marked as {_title_status(data.status)}."}


@router.put("/admin-users/status")
def update_admin_user_status(
    data: AdminUserStatusRequest,
    current_user: dict = Depends(HealthMinistryOnly),
):
    admin_profile = _fetch_single_with_query(
        lambda: supabase_admin.table("admin_profiles")
        .select("id, user_id, admin_role")
        .eq("user_id", data.user_id)
    )
    user = _fetch_single_with_query(
        lambda: supabase_admin.table("users")
        .select("id, email, role, status, pref_name, name")
        .eq("id", data.user_id)
    )
    if not user:
        raise HTTPException(status_code=404, detail="Admin user not found.")

    role = _normalize_status(user.get("role"))
    if role not in _ADMIN_APPROVAL_ROLES:
        raise HTTPException(status_code=400, detail="Only admin-role users can be managed here.")
    if not admin_profile:
        raise HTTPException(status_code=404, detail="Admin profile not found.")

    next_status = _normalize_status(data.status)
    if next_status not in _ADMIN_APPROVAL_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid admin status.")

    execute_with_retry(
        lambda: supabase_admin.table("users")
        .update({"status": next_status})
        .eq("id", data.user_id)
        .execute()
    )
    execute_with_retry(
        lambda: supabase_admin.table("admin_profiles")
        .update({"status": next_status})
        .eq("id", admin_profile["id"])
        .execute()
    )

    _log_audit_action(
        user_id=current_user["user_id"],
        action=f"ADMIN_USER_{next_status.upper()}",
        entity="admin_profiles",
        entity_id=int(admin_profile["id"]),
    )

    display_name = user.get("pref_name") or user.get("name") or user.get("email") or "Admin user"
    return {"message": f"{display_name} marked as {_title_status(next_status)}."}


def _normalize_patient_lookup_query(query: str | None) -> str:
    return " ".join((query or "").strip().upper().split())


def _patient_registry_items(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    user_lookup = _build_user_lookup(row.get("user_id") for row in rows)

    items: list[dict[str, Any]] = []
    for row in rows:
        user = user_lookup.get(str(row.get("user_id")))
        if not user:
            continue
        items.append(
            {
                "patient_id": row.get("id"),
                "user_id": row.get("user_id"),
                "dhid": row.get("dhid"),
                "name": user.get("pref_name") or user.get("name"),
                "preferred_name": user.get("pref_name"),
                "legal_name": user.get("name"),
                "email": user.get("email"),
                "nic": user.get("nic"),
                "address": user.get("address"),
                "role": user.get("role"),
                "status": user.get("status"),
                "created_at": row.get("created_at"),
            }
        )

    return items


@router.get("/patient-registry/search")
def search_patient_registry(
    query: str = Query(..., min_length=1, description="Full DHID or NIC"),
    current_user: dict = Depends(HealthMinistryOnly),
):
    _ = current_user
    normalized_query = _normalize_patient_lookup_query(query)
    if not normalized_query:
        raise HTTPException(status_code=400, detail="Enter a full DHID or NIC.")

    rows: list[dict[str, Any]]
    if normalized_query.startswith("DHID-"):
        if not _FULL_DHID_PATTERN.match(normalized_query) or not validate_dhid(normalized_query):
            raise HTTPException(status_code=400, detail="Enter a full valid DHID.")
        rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("patients")
            .select("id, user_id, dhid, created_at")
            .eq("dhid", normalized_query)
        )
    else:
        if not is_valid_nic(normalized_query):
            raise HTTPException(status_code=400, detail="Enter a full valid NIC.")
        nic_hash = hmac_nic(normalized_query)
        rows = _fetch_rows_with_query(
            lambda: supabase_admin.table("patients")
            .select("id, user_id, dhid, created_at")
            .eq("nic", nic_hash)
        )

    return {"items": _patient_registry_items(rows)}


@router.put("/patient-registry/status")
def update_patient_registry_status(
    data: PatientRegistryStatusRequest,
    current_user: dict = Depends(HealthMinistryOnly),
):
    next_status = (data.status or "").strip().lower()
    if next_status not in {"active", "deactivated"}:
        raise HTTPException(status_code=400, detail="Status must be active or deactivated.")

    patient = _fetch_single_with_query(
        lambda: supabase_admin.table("patients")
        .select("id, user_id, dhid")
        .eq("user_id", data.user_id)
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found.")

    user = _fetch_single_with_query(
        lambda: supabase_admin.table("users")
        .select("id, email, name, pref_name, status")
        .eq("id", data.user_id)
    )
    if not user:
        raise HTTPException(status_code=404, detail="Patient user not found.")

    execute_with_retry(
        lambda: supabase_admin.table("users")
        .update({"status": next_status})
        .eq("id", data.user_id)
        .execute()
    )

    _log_audit_action(
        user_id=current_user["user_id"],
        action=f"PATIENT_{next_status.upper()}",
        entity="patients",
        entity_id=int(patient["id"]),
    )

    display_name = user.get("pref_name") or user.get("name") or user.get("email") or "Patient"
    return {"message": f"{display_name} marked as {_title_account_status(next_status)}."}


@router.put("/suspend")
def suspend_entity(
    data: SuspendRequest,
    current_user: dict = Depends(HealthMinistryOnly),
):
    action = (data.action or "").strip().lower()
    if action not in {"suspend", "activate"}:
        raise HTTPException(status_code=400, detail="Invalid action.")

    if data.target_type == "USER":
        target_table = "users"
        target_status = "suspended" if action == "suspend" else "active"
        entity_id = data.target_id
    elif data.target_type == "ORGANIZATION":
        target_table = "organisations"
        target_status = "suspended" if action == "suspend" else "active"
        entity_id = data.target_id
    else:
        raise HTTPException(status_code=400, detail="Invalid target type.")

    existing = _fetch_single_with_query(
        lambda: supabase_admin.table(target_table).select("id").eq("id", entity_id)
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Target not found.")

    execute_with_retry(
        lambda: supabase_admin.table(target_table)
        .update({"status": target_status})
        .eq("id", entity_id)
        .execute()
    )

    if data.target_type == "ORGANIZATION" and action == "suspend":
        _cascade_organisation_lockdown(entity_id, "suspended", current_user["user_id"])

    if str(entity_id).isdigit():
        _log_audit_action(
            user_id=current_user["user_id"],
            action=f"{data.target_type}_{action.upper()}",
            entity=target_table,
            entity_id=int(entity_id),
        )
    return {"message": f"{data.target_type.title()} marked as {_title_status(target_status)}."}


@router.post("/analytics/incidence")
def disease_incidence(
    data: AnalyticsRequest,
    current_user: dict = Depends(HealthMinistryOnly),
):
    _ = current_user
    counter = _build_diagnosis_counter(
        start_date=data.start_date,
        end_date=data.end_date,
    )
    return dict(counter.most_common())


@router.get("/analytics/top-diagnoses")
def top_diagnoses(current_user: dict = Depends(HealthMinistryOnly)):
    _ = current_user
    counter = _build_diagnosis_counter()
    return counter.most_common(10)


@router.get("/performance/slow-requests")
def list_slow_requests(current_user: dict = Depends(HealthMinistryOnly)):
    _ = current_user
    rows = get_slow_requests()
    return {
        "sla_ms": SLA_MS,
        "total_slow": len(rows),
        "requests": rows,
    }


@router.get("/anomalies")
def list_anomaly_flags(
    status: str | None = Query(None, description="Filter by status: open, resolved, dismissed"),
    current_user: dict = Depends(HealthMinistryOnly),
):
    _ = current_user

    def _query():
        q = supabase_admin.table("anomaly_flags").select("*").order("flagged_at", desc=True).limit(200)
        if status:
            q = q.eq("status", status)
        return q

    rows = _fetch_rows_with_query(_query)

    flags = [
        {
            "id": row.get("id"),
            "event_type": row.get("event_type"),
            "source_ip": row.get("source_ip"),
            "event_count": row.get("event_count"),
            "window_seconds": row.get("window_seconds"),
            "threshold": row.get("threshold"),
            "flagged_at": row.get("flagged_at"),
            "resolved_at": row.get("resolved_at"),
            "resolved_by": row.get("resolved_by"),
            "status": row.get("status"),
        }
        for row in rows
    ]

    open_count = sum(1 for f in flags if f["status"] == "open")
    return {"flags": flags, "total": len(flags), "open_count": open_count}


class ResolveFlagRequest(BaseModel):
    action: str = "resolved"  # "resolved" or "dismissed"


@router.put("/anomalies/{flag_id}/resolve")
def resolve_anomaly_flag(
    flag_id: int,
    data: ResolveFlagRequest,
    current_user: dict = Depends(HealthMinistryOnly),
):
    valid_actions = {"resolved", "dismissed"}
    if data.action not in valid_actions:
        raise HTTPException(status_code=400, detail="action must be 'resolved' or 'dismissed'.")

    existing = _fetch_single_with_query(
        lambda: supabase_admin.table("anomaly_flags").select("id, status").eq("id", flag_id)
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Anomaly flag not found.")

    execute_with_retry(
        lambda: supabase_admin.table("anomaly_flags").update({
            "status": data.action,
            "resolved_at": datetime.now(timezone.utc).isoformat(),
            "resolved_by": current_user.get("user_id"),
        }).eq("id", flag_id).execute(),
        attempts=2,
    )
    return {"message": f"Flag marked as {data.action}."}


@router.post("/reports/monthly")
def generate_report(current_user: dict = Depends(HealthMinistryOnly)):
    organisations = _list_all_organisations()
    doctors = _fetch_rows("doctors", "id, status")
    patients = _fetch_rows("patients", "id")
    last_30_days = datetime.now(timezone.utc) - timedelta(days=30)
    encounter_rows = _fetch_rows_with_query(
        lambda: supabase_admin.table("encounters")
        .select("id, created_at, notes")
        .gte("created_at", last_30_days.isoformat())
        .order("created_at", desc=True)
    )
    diagnosis_counter = Counter()
    for row in encounter_rows:
        diagnosis = _parse_diagnosis(row.get("notes"))
        if diagnosis:
            diagnosis_counter[diagnosis] += 1

    approved_organisations = sum(
        1
        for row in organisations
        if _normalize_status(row.get("status")) in {"approved", "active"}
    )
    approved_doctors = sum(
        1 for row in doctors if _normalize_status(row.get("status")) in {"approved", "active"}
    )
    pending_organisations = sum(
        1 for row in organisations if _normalize_status(row.get("status")) == "pending"
    )
    pending_doctors = sum(
        1 for row in doctors if _normalize_status(row.get("status")) == "pending"
    )
    anomaly_rows = _fetch_rows_with_query(
        lambda: supabase_admin.table("anomaly_flags")
        .select("id, status")
        .order("flagged_at", desc=True)
        .limit(200)
    )
    open_anomalies = sum(
        1 for row in anomaly_rows if _normalize_status(row.get("status")) == "open"
    )
    slow_requests = get_slow_requests()
    recent_audit_threshold = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    recent_audit_events = _fetch_rows_with_query(
        lambda: supabase_admin.table("audit_logs")
        .select("id")
        .gte("timestamp", recent_audit_threshold)
        .limit(500)
    )
    generated_at = datetime.now(timezone.utc).isoformat()
    report_input = {
        "generated_for": current_user.get("name")
        or current_user.get("email")
        or "Health Ministry Admin",
        "generated_at": generated_at,
        "registered_organisations": len(organisations),
        "approved_organisations": approved_organisations,
        "pending_organisations": pending_organisations,
        "registered_doctors": len(doctors),
        "approved_doctors": approved_doctors,
        "pending_doctors": pending_doctors,
        "registered_patients": len(patients),
        "encounters_last_30_days": len(encounter_rows),
        "top_diagnoses": [
            {"label": label, "count": count}
            for label, count in diagnosis_counter.most_common(5)
        ],
        "anomalies": {
            "open_count": open_anomalies,
            "total_count": len(anomaly_rows),
        },
        "performance": {
            "sla_ms": SLA_MS,
            "slow_request_count": len(slow_requests),
        },
        "audit_events_last_24_hours": len(recent_audit_events),
        "data_limitations": [
            "District-level slicing is limited because encounter diagnosis data has no live district column."
        ],
    }

    report = _structured_monthly_report_fallback(report_input)
    ai_sections = _generate_monthly_ai_report_structure(report_input)
    if ai_sections:
        report.update(ai_sections)
    else:
        report["narrative_text"] = _generate_monthly_ai_report(report_input) or report["narrative_text"]

    return {
        "report": report,
        "generated_at": generated_at,
    }
