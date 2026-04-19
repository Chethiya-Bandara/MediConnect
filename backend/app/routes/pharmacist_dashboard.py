# app/routes/pharmacist_dashboard.py
# Pharmacist dashboard endpoints
# Signature verification added by Bihanga (B-4.1.2)

from datetime import datetime
import re
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.config.supabase import execute_with_retry, supabase, supabase_admin
from app.middleware.role_checker import RoleChecker, PharmacistOnly
from app.schemas.pharmacist_schema import DispenseRequest
from app.utils.helpers import validate_dhid

router = APIRouter(prefix="/pharmacist/dashboard", tags=["Pharmacist-dashboard"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class BillItem(BaseModel):
    inventory_id: int
    quantity:     int


class BillRequest(BaseModel):
    pharmacy_id:     int
    prescription_id: int
    items:           list[BillItem]


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


def _prescribed_quantity(item: dict) -> int:
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


def _user_map(user_ids) -> dict:
    ids = _sorted_unique(user_ids)
    if not ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("users")
            .select("id, name, email")
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
            "name": user.get("name"),
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
            "name": user.get("name"),
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


def _encounter_map(encounter_ids) -> dict:
    ids = _sorted_unique(encounter_ids)
    if not ids:
        return {}

    rows = execute_with_retry(
        lambda: (
            supabase_admin.table("encounters")
            .select("id, appointment_id")
            .in_("id", ids)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    return {row["id"]: row for row in rows}


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
    encounter_lookup: dict,
    appointment_lookup: dict,
    organisation_lookup: dict,
    prescription_items_lookup: dict,
) -> dict:
    patient = patient_lookup.get(row.get("patient_id"), {})
    doctor = doctor_lookup.get(row.get("doctor_id"), {})
    encounter = encounter_lookup.get(row.get("encounter_id"), {})
    appointment = appointment_lookup.get(encounter.get("appointment_id"), {})
    organisation = organisation_lookup.get(appointment.get("organisation_id"), {})

    organisation_name = organisation.get("name")
    return {
        "id": row.get("id"),
        "status": row.get("status"),
        "patient_id": row.get("patient_id"),
        "doctor_id": row.get("doctor_id"),
        "created_at": row.get("created_at"),
        "issued_at": row.get("created_at"),
        "patient_dhid": patient.get("dhid"),
        "patient_name": patient.get("name"),
        "doctor_name": doctor.get("name"),
        "hospital_name": organisation_name,
        "organisation_name": organisation_name,
        "total_items": len(prescription_items_lookup.get(row.get("id"), [])),
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
                "patient_name": patient.get("name"),
                "doctor_name": doctor.get("name"),
                "item_count": item_count_lookup.get(row.get("id"), 0),
                "estimated_total": billing.get("total_amount") or row.get("total_price") or 0,
            }
        )

    return history


def reduce_stock(medicine_name: str, pharmacy_id: int, quantity: int) -> dict:
    item = execute_with_retry(
        lambda: (
            supabase_admin.table("inventory")
            .select("id, medicine_name, stock_quantity, unit_price")
            .eq("medicine_name", medicine_name)
            .eq("pharmacy_id", pharmacy_id)
            .single()
            .execute()
        )
    )

    if not item.data:
        raise HTTPException(404, f"{medicine_name} is not stocked in pharmacy {pharmacy_id}.")

    current_stock = item.data.get("stock_quantity", 0)
    if current_stock < quantity:
        raise HTTPException(
            400,
            f"Not enough stock for {medicine_name}. Available: {current_stock}",
        )

    supabase_admin.table("inventory").update({
        "stock_quantity": current_stock - quantity,
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("id", item.data["id"]).execute()
    return item.data


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
            .select("id, status, created_at, patient_id, doctor_id, encounter_id")
            .eq("status", "active")
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    context = _build_prescription_context(prescriptions)
    return [
        _serialize_prescription_summary(row, **context)
        for row in prescriptions
    ]


@router.get("/prescriptions/{prescription_id}", dependencies=[Depends(PharmacistOnly)])
def get_prescription_details(prescription_id: str):
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

    return {
        "prescription": _serialize_prescription_summary(
            prescription.data,
            **context,
        ),
        "items": context["prescription_items_lookup"].get(prescription.data["id"], []),
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
    pharmacist_org_id = user.get("organisation_id")
    items_to_dispense = payload.items

    raw_pharmacy_org_id = payload.pharmacy_id
    if raw_pharmacy_org_id is None:
        raw_pharmacy_org_id = pharmacist_org_id

    if raw_pharmacy_org_id is None:
        raise HTTPException(400, "Pharmacy organisation ID is required before dispensing.")

    try:
        pharmacy_org_id = int(raw_pharmacy_org_id)
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid pharmacy organisation ID.")

    if pharmacist_org_id is not None and pharmacy_org_id != int(pharmacist_org_id):
        raise HTTPException(
            403,
            "You can only dispense against your assigned pharmacy organisation.",
        )

    pharmacy_lookup = _pharmacy_map_by_organisation({pharmacy_org_id})
    pharmacy = pharmacy_lookup.get(pharmacy_org_id)
    if not pharmacy:
        raise HTTPException(404, "No pharmacy record is linked to this organisation.")

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

    if pres.data["status"] == "DISPENSED":
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

        medicine_name = db_item.data.get("medicine_name")
        if not medicine_name:
            raise HTTPException(400, f"Prescription item {item_id} is missing medicine_name")

        inventory_item = reduce_stock(medicine_name, pharmacy_id, qty)

        new_dispensed = (_coerce_int(db_item.data.get("dispensed_quantity")) or 0) + qty
        supabase_admin.table("prescription_items").update({
            "dispensed_quantity": new_dispensed
        }).eq("id", item_id).execute()

        unit_price = float(inventory_item.get("unit_price") or 0)
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
            .select("id, status, created_at, patient_id, doctor_id, encounter_id")
            .eq("patient_id", patient["id"])
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        ),
        default=list,
    )
    context = _build_prescription_context(prescriptions)
    return [
        _serialize_prescription_summary(row, **context)
        for row in prescriptions
    ]


@router.get("/history", dependencies=[Depends(PharmacistOnly)])
def get_dispense_history(user: dict = Depends(PharmacistOnly)):
    pharmacist_org_id = user.get("organisation_id")
    pharmacy_lookup = _pharmacy_map_by_organisation(
        {pharmacist_org_id} if pharmacist_org_id is not None else set()
    )
    pharmacy = pharmacy_lookup.get(pharmacist_org_id)
    if not pharmacy:
        return []

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

    for item in payload.items:

        # ── Fetch price from SERVER-SIDE DB ──────────────────────
        # Client cannot manipulate this price
        try:
            inventory_item = (
                supabase_admin.table("inventory")
                .select("id, medicine_name, unit_price, stock_quantity, pharmacy_id")
                .eq("id", item.inventory_id)
                .eq("pharmacy_id", payload.pharmacy_id)
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

        # ── Validate stock availability ───────────────────────────
        if inventory_item["stock_quantity"] < item.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock for {inventory_item['medicine_name']}. "
                       f"Available: {inventory_item['stock_quantity']}, "
                       f"Requested: {item.quantity}"
            )

        # ── Calculate line total using SERVER price ───────────────
        # unit_price comes from DB — client has NO input here
        server_unit_price = float(inventory_item["unit_price"])
        line_total        = server_unit_price * item.quantity

        bill_lines.append({
            "inventory_id":   item.inventory_id,
            "medicine_name":  inventory_item["medicine_name"],
            "quantity":       item.quantity,
            "unit_price":     server_unit_price,   # ← always from DB
            "line_total":     line_total,
        })

        total_amount += line_total

    # ── Store bill in DB ──────────────────────────────────────────
    try:
        bill = supabase_admin.table("billing").insert({
            "prescription_id": payload.prescription_id,
            "pharmacy_id":     payload.pharmacy_id,
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
        "pharmacy_id":    payload.pharmacy_id,
        "bill_lines":     bill_lines,
        "total_amount":   round(total_amount, 2),
        "currency":       "LKR",
        "note":           "All prices fetched from server-side inventory. "
                          "Client-submitted prices are not accepted.",
        "bill_id":        bill[0]["id"] if bill else None,
    }
