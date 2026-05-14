import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.config.supabase import execute_with_retry, supabase_admin
from app.middleware.role_checker import HealthMinistryOnly

router = APIRouter(prefix="/moh-admin", tags=["deletion-requests"])

_ENTITY_TYPES = frozenset({
    "patient", "doctor", "pharmacist", "hospital_admin", "pharmacy_admin", "health_ministry_admin",
    "medicine", "hospital", "pharmacy", "organisation",
})


class DeletionRequestCreate(BaseModel):
    entity_type: str
    entity_id: str
    entity_display_name: str | None = None
    reason: str | None = None


def _log_deletion_audit(*, user_id: str, action: str, entity: str, entity_id: str) -> None:
    try:
        execute_with_retry(
            lambda: supabase_admin.table("audit_logs").insert({
                "action": action,
                "entity": entity,
                "entity_id": entity_id,
                "user_id": user_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }).execute(),
            attempts=2,
        )
    except Exception:
        logging.exception(
            "Audit log write failed — action=%s entity=%s entity_id=%s user_id=%s",
            action, entity, entity_id, user_id,
        )


def _get_request_or_404(request_id: str) -> dict[str, Any]:
    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("deletion_requests")
            .select("*")
            .eq("id", request_id)
            .execute()
            .data
        ),
        default=[],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Deletion request not found.")
    return rows[0]


def _resolve_request_organisation_id(entity_type: str, entity_id: str) -> str | None:
    if entity_type == "organisation":
        return str(entity_id)

    if entity_type == "hospital":
        rows = execute_with_retry(
            lambda: supabase_admin.table("hospitals")
            .select("organisation_id")
            .eq("id", entity_id)
            .execute()
            .data,
            default=[],
        )
        organisation_id = rows[0].get("organisation_id") if rows else None
        return str(organisation_id) if organisation_id is not None else None

    if entity_type == "pharmacy":
        rows = execute_with_retry(
            lambda: supabase_admin.table("pharmacies")
            .select("organisation_id")
            .eq("id", entity_id)
            .execute()
            .data,
            default=[],
        )
        organisation_id = rows[0].get("organisation_id") if rows else None
        return str(organisation_id) if organisation_id is not None else None

    return None


def _execute_soft_delete(entity_type: str, entity_id: str) -> None:
    """Revoke access by setting status to 'deactivated'. Records are never removed."""
    if entity_type == "patient":
        patient = execute_with_retry(
            lambda: supabase_admin.table("patients").select("user_id").eq("id", entity_id).execute().data,
            default=[],
        )
        if patient and patient[0].get("user_id"):
            uid = patient[0]["user_id"]
            execute_with_retry(
                lambda: supabase_admin.table("users").update({"status": "deactivated"}).eq("id", uid).execute()
            )

    elif entity_type == "doctor":
        doctor = execute_with_retry(
            lambda: supabase_admin.table("doctors").select("user_id").eq("id", entity_id).execute().data,
            default=[],
        )
        execute_with_retry(
            lambda: supabase_admin.table("doctors").update({"status": "deactivated"}).eq("id", entity_id).execute()
        )
        if doctor and doctor[0].get("user_id"):
            uid = doctor[0]["user_id"]
            execute_with_retry(
                lambda: supabase_admin.table("users").update({"status": "deactivated"}).eq("id", uid).execute()
            )

    elif entity_type == "pharmacist":
        pharmacist = execute_with_retry(
            lambda: supabase_admin.table("pharmacists").select("user_id").eq("id", entity_id).execute().data,
            default=[],
        )
        if pharmacist and pharmacist[0].get("user_id"):
            uid = pharmacist[0]["user_id"]
            execute_with_retry(
                lambda: supabase_admin.table("users").update({"status": "deactivated"}).eq("id", uid).execute()
            )

    elif entity_type == "hospital_admin":
        # entity_id is the user UUID for hospital admins
        execute_with_retry(
            lambda: supabase_admin.table("users").update({"status": "deactivated"}).eq("id", entity_id).execute()
        )

    elif entity_type == "pharmacy_admin":
        execute_with_retry(
            lambda: supabase_admin.table("users").update({"status": "deactivated"}).eq("id", entity_id).execute()
        )

    elif entity_type == "health_ministry_admin":
        execute_with_retry(
            lambda: supabase_admin.table("users").update({"status": "deactivated"}).eq("id", entity_id).execute()
        )

    elif entity_type == "medicine":
        execute_with_retry(
            lambda: supabase_admin.table("medicines").update({"status": "deactivated"}).eq("id", entity_id).execute()
        )

    elif entity_type == "hospital":
        hospital = execute_with_retry(
            lambda: supabase_admin.table("hospitals").select("organisation_id").eq("id", entity_id).execute().data,
            default=[],
        )
        if hospital and hospital[0].get("organisation_id"):
            org_id = hospital[0]["organisation_id"]
            execute_with_retry(
                lambda: supabase_admin.table("organisations").update({"status": "deactivated"}).eq("id", org_id).execute()
            )

    elif entity_type == "pharmacy":
        pharmacy = execute_with_retry(
            lambda: supabase_admin.table("pharmacies").select("organisation_id").eq("id", entity_id).execute().data,
            default=[],
        )
        if pharmacy and pharmacy[0].get("organisation_id"):
            org_id = pharmacy[0]["organisation_id"]
            execute_with_retry(
                lambda: supabase_admin.table("organisations").update({"status": "deactivated"}).eq("id", org_id).execute()
            )

    elif entity_type == "organisation":
        execute_with_retry(
            lambda: supabase_admin.table("organisations").update({"status": "deactivated"}).eq("id", entity_id).execute()
        )


def _expire_stale_requests(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    for row in rows:
        if row.get("status") != "pending":
            continue
        raw_exp = row.get("expires_at")
        if not raw_exp:
            continue
        try:
            exp = datetime.fromisoformat(str(raw_exp).replace("Z", "+00:00"))
            if exp < now:
                execute_with_retry(
                    lambda r=row: supabase_admin.table("deletion_requests")
                    .update({"status": "expired"})
                    .eq("id", r["id"])
                    .execute()
                )
                row["status"] = "expired"
        except Exception:
            pass
    return rows


@router.post("/deletion-requests")
def create_deletion_request(
    data: DeletionRequestCreate,
    current_user: dict = Depends(HealthMinistryOnly),
):
    if data.entity_type not in _ENTITY_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid entity_type. Must be one of: {', '.join(sorted(_ENTITY_TYPES))}.",
        )

    existing = execute_with_retry(
        lambda: (
            supabase_admin.table("deletion_requests")
            .select("id")
            .eq("entity_type", data.entity_type)
            .eq("entity_id", str(data.entity_id))
            .eq("status", "pending")
            .execute()
            .data
        ),
        default=[],
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail="A pending deletion request already exists for this entity.",
        )

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=48)

    inserted = execute_with_retry(
        lambda: supabase_admin.table("deletion_requests").insert({
            "entity_type": data.entity_type,
            "entity_id": str(data.entity_id),
            "entity_display_name": data.entity_display_name,
            "requested_by": current_user["user_id"],
            "requested_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "status": "pending",
            "reason": data.reason,
        }).execute().data,
        default=[],
    )

    _log_deletion_audit(
        user_id=current_user["user_id"],
        action="DELETION_REQUESTED",
        entity=data.entity_type,
        entity_id=str(data.entity_id),
    )

    request_id = inserted[0]["id"] if inserted else None
    return {
        "message": "Deletion request submitted. A second Ministry admin must approve within 48 hours.",
        "request_id": request_id,
    }


@router.get("/deletion-requests")
def list_deletion_requests(current_user: dict = Depends(HealthMinistryOnly)):
    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("deletion_requests")
            .select("*")
            .order("requested_at", desc=True)
            .execute()
            .data
        ),
        default=[],
    )

    rows = _expire_stale_requests(rows)

    user_ids = list(
        {r["requested_by"] for r in rows if r.get("requested_by")}
        | {r["approved_by"] for r in rows if r.get("approved_by")}
    )
    user_lookup: dict[str, dict] = {}
    if user_ids:
        users = execute_with_retry(
            lambda: supabase_admin.table("users").select("id, name, email").in_("id", user_ids).execute().data,
            default=[],
        )
        user_lookup = {u["id"]: u for u in users}

    items = []
    for row in rows:
        req_user = user_lookup.get(row.get("requested_by") or "") or {}
        apv_user = user_lookup.get(row.get("approved_by") or "") or {}
        organisation_id = _resolve_request_organisation_id(
            str(row.get("entity_type") or ""),
            str(row.get("entity_id") or ""),
        )
        items.append({
            "id": row.get("id"),
            "entity_type": row.get("entity_type"),
            "entity_id": row.get("entity_id"),
            "organisation_id": organisation_id,
            "entity_display_name": row.get("entity_display_name"),
            "status": row.get("status"),
            "reason": row.get("reason"),
            "requested_at": row.get("requested_at"),
            "expires_at": row.get("expires_at"),
            "approved_at": row.get("approved_at"),
            "requested_by_name": req_user.get("name") or req_user.get("email"),
            "approved_by_name": apv_user.get("name") or apv_user.get("email"),
            "can_approve": row.get("requested_by") != current_user["user_id"] and row.get("status") == "pending",
        })

    return {"items": items}


@router.post("/deletion-requests/{request_id}/approve")
def approve_deletion_request(
    request_id: str,
    current_user: dict = Depends(HealthMinistryOnly),
):
    req = _get_request_or_404(request_id)

    if req.get("status") != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Request is already '{req.get('status')}' and cannot be approved.",
        )

    raw_exp = req.get("expires_at")
    if raw_exp:
        try:
            exp = datetime.fromisoformat(str(raw_exp).replace("Z", "+00:00"))
            if exp < datetime.now(timezone.utc):
                execute_with_retry(
                    lambda: supabase_admin.table("deletion_requests")
                    .update({"status": "expired"})
                    .eq("id", request_id)
                    .execute()
                )
                raise HTTPException(
                    status_code=410,
                    detail="This deletion request has expired (48-hour window passed).",
                )
        except HTTPException:
            raise
        except Exception:
            pass

    if req.get("requested_by") == current_user["user_id"]:
        raise HTTPException(
            status_code=403,
            detail="You cannot approve your own deletion request. A different Ministry admin must approve.",
        )

    _execute_soft_delete(req["entity_type"], req["entity_id"])

    now = datetime.now(timezone.utc)
    execute_with_retry(
        lambda: supabase_admin.table("deletion_requests").update({
            "status": "approved",
            "approved_by": current_user["user_id"],
            "approved_at": now.isoformat(),
        }).eq("id", request_id).execute()
    )

    _log_deletion_audit(
        user_id=current_user["user_id"],
        action="DELETION_APPROVED",
        entity=req["entity_type"],
        entity_id=req["entity_id"],
    )

    display = req.get("entity_display_name") or f"{req['entity_type']} #{req['entity_id']}"
    return {"message": f"{display} has been deactivated. All records are preserved in the database."}


@router.post("/deletion-requests/{request_id}/cancel")
def cancel_deletion_request(
    request_id: str,
    current_user: dict = Depends(HealthMinistryOnly),
):
    req = _get_request_or_404(request_id)

    if req.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Only pending requests can be cancelled.")

    execute_with_retry(
        lambda: supabase_admin.table("deletion_requests")
        .update({"status": "cancelled"})
        .eq("id", request_id)
        .execute()
    )

    _log_deletion_audit(
        user_id=current_user["user_id"],
        action="DELETION_CANCELLED",
        entity=req["entity_type"],
        entity_id=req["entity_id"],
    )

    return {"message": "Deletion request cancelled."}


# ── People registry list endpoints ────────────────────────────────────────────

@router.get("/patients-registry")
def list_patients_registry(current_user: dict = Depends(HealthMinistryOnly)):
    patients = execute_with_retry(
        lambda: supabase_admin.table("patients")
        .select("id, user_id, dhid, created_at")
        .order("created_at", desc=True)
        .execute()
        .data,
        default=[],
    )
    user_ids = [p["user_id"] for p in patients if p.get("user_id")]
    user_lookup: dict[str, dict] = {}
    if user_ids:
        users = execute_with_retry(
            lambda: supabase_admin.table("users").select("id, name, email, status").in_("id", user_ids).execute().data,
            default=[],
        )
        user_lookup = {u["id"]: u for u in users}

    items = []
    for p in patients:
        u = user_lookup.get(p.get("user_id") or "") or {}
        items.append({
            "id": str(p["id"]),
            "user_id": p.get("user_id"),
            "dhid": p.get("dhid"),
            "name": u.get("name"),
            "email": u.get("email"),
            "status": u.get("status", "active"),
            "created_at": p.get("created_at"),
        })
    return {"items": items}


@router.get("/doctors-registry")
def list_doctors_registry(current_user: dict = Depends(HealthMinistryOnly)):
    doctors = execute_with_retry(
        lambda: supabase_admin.table("doctors")
        .select("id, user_id, slmc_number, specialization, status, created_at")
        .order("created_at", desc=True)
        .execute()
        .data,
        default=[],
    )
    user_ids = [d["user_id"] for d in doctors if d.get("user_id")]
    user_lookup: dict[str, dict] = {}
    if user_ids:
        users = execute_with_retry(
            lambda: supabase_admin.table("users").select("id, name, email, status").in_("id", user_ids).execute().data,
            default=[],
        )
        user_lookup = {u["id"]: u for u in users}

    items = []
    for d in doctors:
        u = user_lookup.get(d.get("user_id") or "") or {}
        items.append({
            "id": str(d["id"]),
            "user_id": d.get("user_id"),
            "slmc_number": d.get("slmc_number"),
            "specialization": d.get("specialization"),
            "name": u.get("name"),
            "email": u.get("email"),
            "status": d.get("status", "active"),
            "created_at": d.get("created_at"),
        })
    return {"items": items}


@router.get("/pharmacists-registry")
def list_pharmacists_registry(current_user: dict = Depends(HealthMinistryOnly)):
    pharmacists = execute_with_retry(
        lambda: supabase_admin.table("pharmacists")
        .select("id, user_id, license_no, status, created_at")
        .execute()
        .data,
        default=[],
    )
    user_ids = [p["user_id"] for p in pharmacists if p.get("user_id")]
    user_lookup: dict[str, dict] = {}
    if user_ids:
        users = execute_with_retry(
            lambda: supabase_admin.table("users").select("id, name, email, status").in_("id", user_ids).execute().data,
            default=[],
        )
        user_lookup = {u["id"]: u for u in users}

    items = []
    for p in pharmacists:
        u = user_lookup.get(p.get("user_id") or "") or {}
        items.append({
            "id": str(p["id"]),
            "user_id": p.get("user_id"),
            "license_no": p.get("license_no"),
            "name": u.get("name"),
            "email": u.get("email"),
            "status": p.get("status") or u.get("status", "active"),
            "created_at": p.get("created_at"),
        })
    return {"items": items}


@router.get("/hospital-admins-registry")
def list_hospital_admins_registry(current_user: dict = Depends(HealthMinistryOnly)):
    admins = execute_with_retry(
        lambda: supabase_admin.table("admin_profiles")
        .select("id, created_at, user_id, admin_role, organisation_id, status")
        .order("created_at", desc=True)
        .execute()
        .data,
        default=[],
    )
    user_ids = [a["user_id"] for a in admins if a.get("user_id")]
    user_lookup: dict[str, dict] = {}
    organisation_ids = [a["organisation_id"] for a in admins if a.get("organisation_id") is not None]
    organisation_lookup: dict[int, dict] = {}
    if user_ids:
        users = execute_with_retry(
            lambda: supabase_admin.table("users")
            .select("id, name, email, role, status")
            .in_("id", user_ids)
            .execute()
            .data,
            default=[],
        )
        user_lookup = {u["id"]: u for u in users}
    if organisation_ids:
        organisations = execute_with_retry(
            lambda: supabase_admin.table("organisations")
            .select("id, name")
            .in_("id", organisation_ids)
            .execute()
            .data,
            default=[],
        )
        organisation_lookup = {
            int(org["id"]): org for org in organisations if org.get("id") is not None
        }

    items = []
    for a in admins:
        u = user_lookup.get(a.get("user_id") or "") or {}
        if not u:
            continue
        organisation = None
        try:
            if a.get("organisation_id") is not None:
                organisation = organisation_lookup.get(int(a["organisation_id"]))
        except (TypeError, ValueError):
            organisation = None
        items.append({
            "id": str(u["id"]),  # user_id is the stable identifier for hospital admins
            "user_id": u["id"],
            "name": u.get("name"),
            "email": u.get("email"),
            "admin_role": a.get("admin_role"),
            "organisation_id": a.get("organisation_id"),
            "organisation_name": organisation.get("name") if organisation else None,
            "status": a.get("status") or u.get("status", "active"),
            "created_at": a.get("created_at"),
        })
    return {"items": items}
