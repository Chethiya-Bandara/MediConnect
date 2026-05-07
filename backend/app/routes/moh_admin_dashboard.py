from collections import Counter
from datetime import datetime, timedelta, timezone
import re
from typing import Any, Iterable

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.config.supabase import execute_with_retry, supabase_admin
from app.middleware.role_checker import HealthMinistryOnly
from app.middleware.performance import SLA_MS, get_slow_requests
from app.schemas.moh_admin_schema import (
    AnalyticsRequest,
    DoctorApprovalRequest,
    MedicineUpsertRequest,
    OrganizationApprovalRequest,
    OrganizationCreateRequest,
    SuspendRequest,
)


router = APIRouter(prefix="/moh-admin", tags=["moh-admin-dashboard"])

_DIAGNOSIS_PATTERN = re.compile(r"Diagnosis:\s*(.+?)(?:\r?\n|$)", re.IGNORECASE)


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
    return (value or "").strip().lower()


def _clean_medicine_text(value: str | None) -> str:
    return " ".join((value or "").replace("\xa0", " ").split())


def _title_status(value: str | None) -> str:
    normalized = _normalize_status(value)
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
        .select("id, email, role, name, status")
        .in_("id", values)
    )
    return {str(row["id"]): row for row in rows if row.get("id") is not None}


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


@router.get("/dashboard")
def get_dashboard(current_user: dict = Depends(HealthMinistryOnly)):
    organisations = _list_all_organisations()
    doctors = _fetch_rows_with_query(
        lambda: supabase_admin.table("doctors")
        .select("id, created_at, specialization, user_id, slmc_number, status")
        .order("created_at", desc=True)
    )
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
        [row.get("user_id") for row in doctors] + [row.get("user_id") for row in all_audit_rows]
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
                "email": user.get("email") if user else None,
                "specialization": doctor.get("specialization"),
                "slmc_number": doctor.get("slmc_number"),
                "status": doctor.get("status"),
                "created_at": doctor.get("created_at"),
            }
        )

    organisation_lookup = _build_organisation_lookup(
        [row.get("entity_id") for row in all_audit_rows if row.get("entity") == "organisations"]
    )
    audit_logs: list[dict[str, Any]] = []
    for row in all_audit_rows:
        actor = user_lookup.get(str(row.get("user_id")))
        organisation = None
        if row.get("entity") == "organisations":
            try:
                organisation = organisation_lookup.get(int(row.get("entity_id")))
            except (TypeError, ValueError):
                organisation = None

        audit_logs.append(
            {
                "id": row.get("id"),
                "timestamp": row.get("timestamp"),
                "actor_id": row.get("user_id"),
                "actor_name": actor.get("name") if actor else None,
                "actor_role": actor.get("role") if actor else None,
                "organisation_id": organisation.get("id") if organisation else None,
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
            "total_patients": len(patients),
            "audit_events_24h": len(audit_rows),
        },
        "pending_organisations": pending_organisations,
        "pending_doctors": pending_doctors,
        "audit_logs": audit_logs,
        "viewer": {
            "user_id": current_user.get("user_id"),
            "role": current_user.get("role"),
        },
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


@router.put("/suspend")
def suspend_entity(
    data: SuspendRequest,
    current_user: dict = Depends(HealthMinistryOnly),
):
    action = _normalize_status(data.action)
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
    top_lines = diagnosis_counter.most_common(3)
    top_summary = (
        ", ".join(f"{label} ({count})" for label, count in top_lines)
        if top_lines
        else "No diagnosis-coded encounter notes were recorded in the selected period."
    )

    report = (
        "Monthly national health summary\n\n"
        f"Generated for: {current_user.get('name') or current_user.get('email') or 'Health Ministry Admin'}\n"
        f"Generated at: {datetime.now(timezone.utc).isoformat()}\n\n"
        f"Registered organisations: {len(organisations)}\n"
        f"Approved or active organisations: {approved_organisations}\n"
        f"Registered doctors: {len(doctors)}\n"
        f"Approved or active doctors: {approved_doctors}\n"
        f"Registered patients: {len(patients)}\n"
        f"Encounters in the last 30 days: {len(encounter_rows)}\n"
        f"Top diagnosis signals from encounter notes: {top_summary}\n\n"
        "District-level slicing is currently limited because the live schema does not expose a district column for encounter diagnosis data."
    )

    return {
        "report": report,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
