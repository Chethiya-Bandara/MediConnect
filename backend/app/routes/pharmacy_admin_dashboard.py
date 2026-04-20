from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.config.supabase import execute_with_retry, supabase_admin
from app.middleware.role_checker import RoleChecker
from app.schemas.pharmacy_admin_schema import (
    CreateMedicineRequest,
    CreatePharmacyStaffRequest,
    UpdateInventoryRequest,
    UpdateStaffStatusRequest,
)

router = APIRouter(prefix="/pharmacy-admin", tags=["pharmacy-admin-dashboard"])


def _coerce_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _coerce_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _parse_datetime(value: str | None):
    if not value:
        return None

    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _resolve_pharmacy_record(raw_pharmacy_id):
    if raw_pharmacy_id is None:
        raise HTTPException(status_code=400, detail="Pharmacy identifier is required")

    try:
        pharmacy_id = int(raw_pharmacy_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid pharmacy identifier")

    direct_rows = execute_with_retry(
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
    if direct_rows:
        return direct_rows[0]

    organisation_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("pharmacies")
            .select("*")
            .eq("organisation_id", pharmacy_id)
            .limit(1)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    if organisation_rows:
        return organisation_rows[0]

    raise HTTPException(
        status_code=404,
        detail=(
            f"No pharmacy row exists for identifier {pharmacy_id}. "
            "The client is probably sending an organisation ID that is not linked to a pharmacy row."
        ),
    )


def _assert_admin_scope(current_user: dict, pharmacy: dict):
    admin_org_id = current_user.get("organisation_id")
    pharmacy_org_id = pharmacy.get("organisation_id")

    if admin_org_id is None or pharmacy_org_id is None:
        return

    if _coerce_int(admin_org_id, -1) != _coerce_int(pharmacy_org_id, -2):
        raise HTTPException(
            status_code=403,
            detail="You can only manage staff and stock for your assigned pharmacy organisation.",
        )


def _find_medicine_by_name(name: str):
    normalized = name.strip()
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
        default=[],
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
        default=[],
    )
    return rows[0] if rows else None


def _find_medicine_by_id(medicine_id: int | None):
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
        default=[],
    )
    return rows[0] if rows else None


def _search_medicines(query: str, limit: int = 8):
    normalized = query.strip()
    if len(normalized) < 2:
        return []

    rows = execute_with_retry(
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
    return rows


def _medicine_map(medicine_ids: set[int]):
    if not medicine_ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("medicines")
            .select("id, name, retail_price, wholesale_price, unit")
            .in_("id", list(medicine_ids))
            .execute()
            .data
            or []
        ),
        default=[],
    )
    return {row["id"]: row for row in rows}


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
        default=[],
    )


def _inventory_item_or_404(item_id: str):
    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("inventory")
            .select("*")
            .eq("id", item_id)
            .limit(1)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Item not found")
    return rows[0]


def _staff_member_or_404(staff_id: str):
    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("pharmacists")
            .select("*")
            .eq("id", staff_id)
            .limit(1)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Pharmacist not found")
    return rows[0]


def _dispensing_rows_for_pharmacy(pharmacy_id: int):
    return execute_with_retry(
        lambda: (
            supabase_admin.table("dispensing")
            .select("*")
            .eq("pharmacy_id", pharmacy_id)
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        ),
        default=[],
    )


def _build_inventory_summary(rows: list[dict]):
    total_items = len(rows)
    total_inventory_value = round(
        sum(
            _coerce_int(row.get("stock_quantity")) * _coerce_float(row.get("unit_price"))
            for row in rows
        ),
        2,
    )
    low_stock_items = sum(
        1
        for row in rows
        if 0 < _coerce_int(row.get("stock_quantity")) <= 25
    )
    out_of_stock_items = sum(
        1
        for row in rows
        if _coerce_int(row.get("stock_quantity")) <= 0
    )
    return {
        "total_items": total_items,
        "total_inventory_value": total_inventory_value,
        "low_stock_items": low_stock_items,
        "out_of_stock_items": out_of_stock_items,
    }


def _build_recent_adjustments(rows: list[dict], medicine_lookup: dict[int, dict]):
    ordered_rows = sorted(
        rows,
        key=lambda row: _parse_datetime(row.get("updated_at") or row.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )

    adjustments = []
    for row in ordered_rows[:6]:
        medicine = medicine_lookup.get(row.get("medicine_id"), {})
        created_at = row.get("created_at")
        updated_at = row.get("updated_at")
        adjustment_type = "Created"
        if updated_at and updated_at != created_at:
            adjustment_type = "Updated"

        adjustments.append(
            {
                "id": row.get("id"),
                "timestamp": updated_at or created_at,
                "medicine_name": (
                    medicine.get("name")
                    or row.get("medicine_name")
                    or row.get("drug_name")
                    or "Unnamed medicine"
                ),
                "adjustment_type": adjustment_type,
                "stock_quantity": _coerce_int(row.get("stock_quantity")),
                "unit_price": _coerce_float(row.get("unit_price")),
            }
        )

    return adjustments


def _build_fast_moving_items(dispensing_rows: list[dict]):
    dispensing_ids = [row.get("id") for row in dispensing_rows if row.get("id") is not None]
    if not dispensing_ids:
        return []

    dispensing_item_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("dispensing_items")
            .select("*")
            .in_("dispensing_id", dispensing_ids)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    prescription_item_ids = {
        row.get("prescription_item_id")
        for row in dispensing_item_rows
        if row.get("prescription_item_id") is not None
    }
    prescription_item_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("prescription_items")
            .select("id, medicine_name")
            .in_("id", list(prescription_item_ids))
            .execute()
            .data
            or []
        ),
        default=[],
    ) if prescription_item_ids else []
    prescription_item_lookup = {
        row.get("id"): row.get("medicine_name") or "Unnamed medicine"
        for row in prescription_item_rows
    }

    totals = {}
    for row in dispensing_item_rows:
        medicine_name = prescription_item_lookup.get(row.get("prescription_item_id"), "Unnamed medicine")
        totals[medicine_name] = totals.get(medicine_name, 0) + _coerce_int(row.get("quantity_dispensed"))

    ordered = sorted(totals.items(), key=lambda item: item[1], reverse=True)
    return [
        {"medicine_name": medicine_name, "units_dispensed": units_dispensed}
        for medicine_name, units_dispensed in ordered[:5]
    ]


def _build_staff_rows(pharmacy: dict):
    organisation_id = pharmacy.get("organisation_id")
    pharmacist_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("pharmacists")
            .select("*")
            .eq("organisation_id", organisation_id)
            .order("created_at")
            .execute()
            .data
            or []
        ),
        default=[],
    ) if organisation_id is not None else []

    user_ids = [row.get("user_id") for row in pharmacist_rows if row.get("user_id")]
    user_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("users")
            .select("id, email, name, role, status")
            .in_("id", user_ids)
            .execute()
            .data
            or []
        ),
        default=[],
    ) if user_ids else []
    user_lookup = {row.get("id"): row for row in user_rows}

    dispensing_rows = _dispensing_rows_for_pharmacy(_coerce_int(pharmacy.get("id")))
    staff_activity = {}
    for row in dispensing_rows:
        pharmacist_id = row.get("pharmacist_id")
        if not pharmacist_id:
            continue
        entry = staff_activity.setdefault(
            str(pharmacist_id),
            {"dispense_events_count": 0, "last_dispensed_at": None},
        )
        entry["dispense_events_count"] += 1
        current_last = _parse_datetime(entry["last_dispensed_at"])
        candidate = row.get("created_at") or row.get("dispensed_at")
        candidate_dt = _parse_datetime(candidate)
        if candidate_dt and (current_last is None or candidate_dt > current_last):
            entry["last_dispensed_at"] = candidate

    return [
        {
            "id": row.get("id"),
            "user_id": row.get("user_id"),
            "name": user_lookup.get(row.get("user_id"), {}).get("name") or "Unnamed pharmacist",
            "email": user_lookup.get(row.get("user_id"), {}).get("email"),
            "license_no": row.get("license_no"),
            "organisation_id": row.get("organisation_id"),
            "status": user_lookup.get(row.get("user_id"), {}).get("status") or "active",
            "dispense_events_count": staff_activity.get(str(row.get("user_id")), {}).get("dispense_events_count", 0),
            "last_dispensed_at": staff_activity.get(str(row.get("user_id")), {}).get("last_dispensed_at"),
        }
        for row in pharmacist_rows
    ]


def _build_dashboard_payload(pharmacy: dict):
    inventory_rows = _inventory_rows_for_pharmacy(_coerce_int(pharmacy.get("id")))
    medicine_lookup = _medicine_map(
        {row.get("medicine_id") for row in inventory_rows if row.get("medicine_id") is not None}
    )
    dispensing_rows = _dispensing_rows_for_pharmacy(_coerce_int(pharmacy.get("id")))
    now = datetime.now(timezone.utc)

    today_revenue = 0.0
    current_month_revenue = 0.0
    total_tracked_revenue = 0.0
    for row in dispensing_rows:
        amount = _coerce_float(row.get("total_price"))
        total_tracked_revenue += amount
        created_at = _parse_datetime(row.get("created_at"))
        if not created_at:
            continue
        if created_at.date() == now.date():
            today_revenue += amount
        if created_at.year == now.year and created_at.month == now.month:
            current_month_revenue += amount

    return {
        "pharmacy_id": pharmacy.get("id"),
        "organisation_id": pharmacy.get("organisation_id"),
        "inventory_summary": _build_inventory_summary(inventory_rows),
        "report_summary": {
            "today_revenue": round(today_revenue, 2),
            "current_month_revenue": round(current_month_revenue, 2),
            "total_tracked_revenue": round(total_tracked_revenue, 2),
            "dispense_events": len(dispensing_rows),
            "fast_moving_items": _build_fast_moving_items(dispensing_rows),
            "recent_adjustments": _build_recent_adjustments(inventory_rows, medicine_lookup),
        },
        "staff": _build_staff_rows(pharmacy),
    }


@router.get("/medicines/search")
def search_medicines(
    query: str = Query(default=""),
    _: dict = Depends(RoleChecker(["pharmacy_admin"])),
):
    return {
        "items": _search_medicines(query),
    }


@router.get("/dashboard/{pharmacy_id}")
def dashboard(
    pharmacy_id: str,
    current_user: dict = Depends(RoleChecker(["pharmacy_admin"])),
):
    pharmacy = _resolve_pharmacy_record(pharmacy_id)
    _assert_admin_scope(current_user, pharmacy)
    return _build_dashboard_payload(pharmacy)


@router.post("/inventory")
def add_medicine(
    data: CreateMedicineRequest,
    current_user: dict = Depends(RoleChecker(["pharmacy_admin"])),
):
    pharmacy = _resolve_pharmacy_record(data.pharmacy_id)
    _assert_admin_scope(current_user, pharmacy)
    medicine = _find_medicine_by_id(data.medicine_id) or _find_medicine_by_name(data.medicine_name)
    if not medicine:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Medicine '{data.medicine_name}' was not found in the central medicines table. "
                "Add it to the catalog first, then attach stock."
            ),
        )

    res = supabase_admin.table("inventory").insert(
        {
            "pharmacy_id": pharmacy["id"],
            "medicine_id": medicine["id"],
            "stock_quantity": data.stock_quantity,
            "unit_price": medicine.get("retail_price") or data.unit_price or 0,
            "created_at": datetime.utcnow().isoformat(),
        }
    ).execute()

    if not res.data:
        raise HTTPException(status_code=400, detail="Failed to add medicine")

    return {
        "message": "Medicine added",
        "pharmacy_id": pharmacy["id"],
        "medicine_name": medicine.get("name"),
        "unit_price": medicine.get("retail_price") or data.unit_price or 0,
    }


@router.put("/inventory")
def update_inventory(
    data: UpdateInventoryRequest,
    current_user: dict = Depends(RoleChecker(["pharmacy_admin"])),
):
    existing_row = _inventory_item_or_404(data.id)
    pharmacy = _resolve_pharmacy_record(existing_row.get("pharmacy_id"))
    _assert_admin_scope(current_user, pharmacy)

    res = supabase_admin.table("inventory").update(
        {
            "stock_quantity": data.stock_quantity,
            "unit_price": data.unit_price,
            "updated_at": datetime.utcnow().isoformat(),
        }
    ).eq("id", data.id).execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Item not found")

    return {"message": "Inventory updated"}


@router.get("/inventory/{pharmacy_id}")
def get_inventory(
    pharmacy_id: str,
    current_user: dict = Depends(RoleChecker(["pharmacy_admin"])),
):
    pharmacy = _resolve_pharmacy_record(pharmacy_id)
    _assert_admin_scope(current_user, pharmacy)

    rows = _inventory_rows_for_pharmacy(_coerce_int(pharmacy.get("id")))
    medicine_lookup = _medicine_map(
        {row.get("medicine_id") for row in rows if row.get("medicine_id")}
    )

    return [
        {
            **row,
            "pharmacy_id": pharmacy.get("id"),
            "medicine_name": (
                medicine_lookup.get(row.get("medicine_id"), {}).get("name")
                or row.get("medicine_name")
                or row.get("drug_name")
            ),
            "medicine_unit": medicine_lookup.get(row.get("medicine_id"), {}).get("unit"),
        }
        for row in rows
    ]


@router.delete("/inventory/{item_id}")
def delete_medicine(
    item_id: str,
    current_user: dict = Depends(RoleChecker(["pharmacy_admin"])),
):
    existing_row = _inventory_item_or_404(item_id)
    pharmacy = _resolve_pharmacy_record(existing_row.get("pharmacy_id"))
    _assert_admin_scope(current_user, pharmacy)

    res = supabase_admin.table("inventory").delete().eq("id", item_id).execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Item not found")

    return {"message": "Medicine removed"}


@router.post("/staff")
def register_staff_member(
    data: CreatePharmacyStaffRequest,
    current_user: dict = Depends(RoleChecker(["pharmacy_admin"])),
):
    pharmacy = _resolve_pharmacy_record(data.pharmacy_id)
    _assert_admin_scope(current_user, pharmacy)

    existing_user_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("users")
            .select("id, email, role")
            .ilike("email", data.email.strip())
            .limit(1)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    if existing_user_rows:
        raise HTTPException(
            status_code=409,
            detail="That email is already linked to another user account.",
        )

    existing_license_rows = execute_with_retry(
        lambda: (
            supabase_admin.table("pharmacists")
            .select("id")
            .ilike("license_no", data.license_no.strip())
            .limit(1)
            .execute()
            .data
            or []
        ),
        default=[],
    )
    if existing_license_rows:
        raise HTTPException(
            status_code=409,
            detail="That pharmacist license number is already registered.",
        )

    created_user = None
    try:
        auth_res = supabase_admin.auth.admin.create_user(
            {
                "email": data.email.strip(),
                "password": data.password,
                "email_confirm": True,
                "user_metadata": {
                    "full_name": data.full_name.strip(),
                    "role": "pharmacist",
                },
            }
        )
        created_user = getattr(auth_res, "user", None)
        user_id = getattr(created_user, "id", None)
        if not user_id:
            raise HTTPException(status_code=500, detail="Auth user could not be created.")

        supabase_admin.table("users").insert(
            {
                "id": user_id,
                "email": data.email.strip(),
                "role": "pharmacist",
                "name": data.full_name.strip(),
                "status": data.status,
            }
        ).execute()

        supabase_admin.table("pharmacists").insert(
            {
                "user_id": user_id,
                "organisation_id": pharmacy.get("organisation_id"),
                "license_no": data.license_no.strip(),
            }
        ).execute()
    except HTTPException:
        if created_user and getattr(created_user, "id", None):
            supabase_admin.auth.admin.delete_user(created_user.id)
        raise
    except Exception as exc:
        if created_user and getattr(created_user, "id", None):
            supabase_admin.auth.admin.delete_user(created_user.id)
        raise HTTPException(
            status_code=500,
            detail=f"Pharmacist registration failed: {exc}",
        )

    return {
        "message": f"{data.full_name.strip()} registered successfully.",
        "email": data.email.strip(),
        "status": data.status,
    }


@router.put("/staff/{staff_id}/status")
def update_staff_status(
    staff_id: str,
    data: UpdateStaffStatusRequest,
    current_user: dict = Depends(RoleChecker(["pharmacy_admin"])),
):
    pharmacy = _resolve_pharmacy_record(data.pharmacy_id)
    _assert_admin_scope(current_user, pharmacy)

    staff_row = _staff_member_or_404(staff_id)
    if _coerce_int(staff_row.get("organisation_id"), -1) != _coerce_int(pharmacy.get("organisation_id"), -2):
        raise HTTPException(
            status_code=403,
            detail="That pharmacist does not belong to your pharmacy organisation.",
        )

    user_id = staff_row.get("user_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Staff row is missing a linked user.")

    updated_rows = supabase_admin.table("users").update({"status": data.status}).eq("id", user_id).execute().data or []
    if not updated_rows:
        raise HTTPException(status_code=404, detail="Linked user account was not found.")

    return {
        "message": f"Pharmacist account marked as {data.status}.",
        "status": data.status,
    }
