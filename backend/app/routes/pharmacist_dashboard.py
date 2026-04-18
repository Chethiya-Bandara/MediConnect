# app/routes/pharmacist_dashboard.py
# Pharmacist dashboard endpoints
# Signature verification added by Bihanga (B-4.1.2)

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.config.supabase import supabase, supabase_admin
from app.middleware.role_checker import RoleChecker, PharmacistOnly
from app.middleware.prescription_signer import (
    build_prescription_payload,
    verify_prescription_signature,
)
from app.utils.helpers import validate_dhid

router = APIRouter(prefix="/pharmacist/dashboard", tags=["Pharmacist-dashboard"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class DispenseItem(BaseModel):
    id:       int
    quantity: int


class DispenseRequest(BaseModel):
    pharmacy_id: int
    items:       list[DispenseItem]


class BillItem(BaseModel):
    inventory_id: int
    quantity:     int


class BillRequest(BaseModel):
    pharmacy_id:     int
    prescription_id: int
    items:           list[BillItem]


# ── Helper ────────────────────────────────────────────────────────────────────

def reduce_stock(drug_name: str, pharmacy_id: int, quantity: int):
    item = (
        supabase.table("inventory")
        .select("*")
        .eq("drug_name", drug_name)
        .eq("pharmacy_id", pharmacy_id)
        .single()
        .execute()
    )
    if item.data["stock"] < quantity:
        raise HTTPException(400, "Not enough stock")

    supabase.table("inventory").update({
        "stock": item.data["stock"] - quantity
    }).eq("id", item.data["id"]).execute()


# ── Prescription Endpoints ────────────────────────────────────────────────────

@router.get("/prescriptions", dependencies=[Depends(PharmacistOnly)])
def get_prescriptions():
    """
    Returns all active prescriptions for dispensing.
    Pharmacists only.
    Clinical notes and encounter data are deliberately excluded.
    Only pharmacy-relevant fields are returned (B-4.2.1)
    """
    res = (
        supabase_admin.table("prescriptions")
        .select(
            "id, status, created_at, patient_id, doctor_id, signature"
            # ❌ encounter_id excluded — prevents joining to clinical notes
            # ❌ notes excluded — clinical data not for pharmacists
        )
        .eq("status", "active")
        .execute()
    )
    return res.data


@router.get("/prescriptions/{prescription_id}", dependencies=[Depends(PharmacistOnly)])
def get_prescription_details(prescription_id: str):
    """
    Returns prescription details and items for dispensing.
    Pharmacists only.
    Clinical notes and encounter data strictly excluded (B-4.2.1)
    """
    # ── Pharmacy-safe prescription fields only ────────────────────
    prescription = (
        supabase_admin.table("prescriptions")
        .select(
            "id, status, created_at, patient_id, doctor_id, signature"
            # ❌ encounter_id excluded — no path to clinical notes
        )
        .eq("id", prescription_id)
        .single()
        .execute()
    )

    if not prescription.data:
        raise HTTPException(status_code=404, detail="Prescription not found")

    # ── Pharmacy-safe prescription items only ─────────────────────
    items = (
        supabase_admin.table("prescription_items")
        .select(
            "id, prescription_id, medicine_name, dosage, quantity, instructions, dispensed_quantity"
            # ❌ No clinical fields — only dispensing-relevant data
        )
        .eq("prescription_id", prescription_id)
        .execute()
    )

    return {
        "prescription": prescription.data,
        "items":        items.data,
        "note":         "Clinical notes and encounter data are not available to pharmacy staff."
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

    # ── Get prescription ──────────────────────────────────────────
    try:
        prescription = (
            supabase_admin.table("prescriptions")
            .select("id, status, created_at, patient_id, doctor_id, signature")
            # ❌ encounter_id excluded — no path to clinical notes (B-5.1.1)
            .eq("id", prescription_id)
            .single()
            .execute()
            .data
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Prescription not found")

    if not prescription:
        raise HTTPException(status_code=404, detail="Prescription not found")

    # ── Check signature exists ────────────────────────────────────
    signature = prescription.get("signature")
    if not signature:
        return {
            "prescription_id": prescription_id,
            "valid":           False,
            "status":          "UNSIGNED",
            "message":         "This prescription has no digital signature. "
                               "It may have been created before signing was implemented.",
            "safe_to_dispense": False,
        }

    # ── Get prescription items ────────────────────────────────────
    try:
        items = (
            supabase_admin.table("prescription_items")
            .select("*")
            .eq("prescription_id", prescription_id)
            .execute()
            .data or []
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Could not fetch prescription items")

    # ── Get doctor's public key ───────────────────────────────────
    doctor_id = prescription.get("doctor_id")
    try:
        doctor = (
            supabase_admin.table("doctors")
            .select("id, public_key")
            .eq("id", doctor_id)
            .single()
            .execute()
            .data
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Doctor not found")

    public_key = doctor.get("public_key") if doctor else None
    if not public_key:
        return {
            "prescription_id": prescription_id,
            "valid":           False,
            "status":          "NO_PUBLIC_KEY",
            "message":         "Doctor's public key is not registered. "
                               "Cannot verify this prescription.",
            "safe_to_dispense": False,
        }

    # ── Rebuild canonical payload ─────────────────────────────────
    payload_str = build_prescription_payload(
        prescription_id = prescription_id,
        patient_id      = prescription.get("patient_id"),
        doctor_id       = doctor_id,
        items           = items,
        created_at      = str(prescription.get("created_at", ""))
    )

    # ── Verify signature ──────────────────────────────────────────
    is_valid = verify_prescription_signature(
        payload_str    = payload_str,
        signature_b64  = signature,
        public_key_pem = public_key
    )

    # ── Log verification attempt ──────────────────────────────────
    try:
        supabase_admin.table("audit_logs").insert({
            "action":    "PRESCRIPTION_VERIFIED" if is_valid else "PRESCRIPTION_VERIFY_FAILED",
            "entity":    "prescriptions",
            "entity_id": prescription_id,
            "timestamp": datetime.now().astimezone().isoformat(),
        }).execute()
    except Exception:
        pass

    return {
        "prescription_id":  prescription_id,
        "valid":            is_valid,
        "status":           "VALID" if is_valid else "INVALID",
        "message":          "Prescription signature is valid. Safe to dispense."
                            if is_valid else
                            "Prescription signature is INVALID. "
                            "Do NOT dispense — this prescription may have been tampered with.",
        "safe_to_dispense": is_valid,
        "doctor_id":        doctor_id,
        "patient_id":       prescription.get("patient_id"),
    }


# ── Dispense Endpoint ─────────────────────────────────────────────────────────

@router.post("/dispense/{prescription_id}")
def dispense_prescription(
    prescription_id: str,
    payload: DispenseRequest,
    user: dict = Depends(PharmacistOnly)
):
    """Dispenses a prescription. Pharmacists only."""
    pharmacist_id    = user.get("user_id")
    pharmacy_id      = payload.pharmacy_id
    items_to_dispense = payload.items

    pres = (
        supabase_admin.table("prescriptions")
        .select("id, status, patient_id, doctor_id")
        # ❌ encounter_id excluded — no path to clinical notes (B-5.1.1)
        .eq("id", prescription_id)
        .single()
        .execute()
    )

    if not pres.data:
        raise HTTPException(404, "Prescription not found")

    if pres.data["status"] == "DISPENSED":
        raise HTTPException(400, "Prescription already fully dispensed.")

    for item in items_to_dispense:
        item_id = item.id
        qty     = item.quantity

        db_item = supabase_admin.table("prescription_items") \
            .select("*") \
            .eq("id", item_id) \
            .single() \
            .execute()

        if not db_item.data:
            raise HTTPException(404, f"Item {item_id} not found")

        remaining = db_item.data["quantity"] - db_item.data.get("dispensed_quantity", 0)

        if qty > remaining:
            raise HTTPException(400, f"Cannot dispense more than remaining ({remaining})")

        reduce_stock(db_item.data["drug_name"], pharmacy_id, qty)

        new_dispensed = db_item.data.get("dispensed_quantity", 0) + qty
        supabase_admin.table("prescription_items").update({
            "dispensed_quantity": new_dispensed
        }).eq("id", item_id).execute()

    all_items  = supabase_admin.table("prescription_items") \
        .select("*") \
        .eq("prescription_id", prescription_id) \
        .execute()

    fully_done = all(
        item.get("dispensed_quantity", 0) >= item["quantity"]
        for item in all_items.data
    )

    new_status = "DISPENSED" if fully_done else "PARTIALLY_DISPENSED"

    supabase_admin.table("prescriptions").update({
        "status": new_status
    }).eq("id", prescription_id).execute()

    supabase_admin.table("dispensations").insert({
        "prescription_id": prescription_id,
        "pharmacist_id":   pharmacist_id,
        "dispensed_at":    datetime.utcnow().isoformat(),
        "status":          new_status
    }).execute()

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

    # Return pharmacy-safe prescription fields only
    return (
        supabase_admin.table("prescriptions")
        .select(
            "id, status, created_at, patient_id, doctor_id, signature"
            # ❌ encounter_id excluded — no path to clinical notes
        )
        .eq("patient_id", patient["id"])
        .execute()
        .data
    )

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
