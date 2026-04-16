from fastapi import APIRouter, Depends, HTTPException
from app.config.supabase import supabase
from datetime import datetime
from app.middleware.role_checker import RoleChecker
from app.schemas.pharmacist_schema import DispenseItem, DispenseRequest

router = APIRouter(prefix="/pharmacist/dashboard", tags=["Pharmacist-dashboard"])

@router.get("/prescriptions")
def get_prescriptions():
    res = supabase.table("prescriptions") \
        .select("*") \
        .eq("status", "PENDING") \
        .execute()

    return res.data

@router.get("/prescriptions/{prescription_id}")
def get_prescription_details(prescription_id: str):

    prescription = supabase.table("prescriptions") \
        .select("*") \
        .eq("id", prescription_id) \
        .single() \
        .execute()

    items = supabase.table("prescription_items") \
        .select("*") \
        .eq("prescription_id", prescription_id) \
        .execute()

    return {
        "prescription": prescription.data,
        "items": items.data
    }


@router.post("/dispense/{prescription_id}")
def dispense_prescription(
    prescription_id: str,
    payload: DispenseRequest,
    user = Depends(RoleChecker(["PHARMACIST"]))
):

    pharmacist_id = user["id"]
    pharmacy_id = payload.pharmacy_id
    items_to_dispense = payload.items

    # 1. Get prescription
    pres = supabase.table("prescriptions") \
        .select("*") \
        .eq("id", prescription_id) \
        .single() \
        .execute()

    if not pres.data:
        raise HTTPException(404, "Prescription not found")
    
    if pres.data["status"] == "DISPENSED":
        raise HTTPException(400, "Prescription already fully dispensed.")

    # 2. Loop through items
    for item in items_to_dispense:

        item_id = item.id
        qty = item.quantity

        db_item = supabase.table("prescription_items") \
            .select("*") \
            .eq("id", item_id) \
            .single() \
            .execute()

        if not db_item.data:
            raise HTTPException(404, f"Item {item_id} not found")

        remaining = db_item.data["quantity"] - db_item.data.get("dispensed_quantity", 0)

        if qty > remaining:
            raise HTTPException(400, f"Cannot dispense more than remaining ({remaining})")

        # 3. Reduce stock
        reduce_stock(db_item.data["drug_name"], pharmacy_id, qty)

        # 4. Update dispensed quantity
        new_dispensed = db_item.data.get("dispensed_quantity", 0) + qty

        supabase.table("prescription_items").update({
            "dispensed_quantity": new_dispensed
        }).eq("id", item_id).execute()

    # 5. Determine overall status
    all_items = supabase.table("prescription_items") \
        .select("*") \
        .eq("prescription_id", prescription_id) \
        .execute()

    fully_done = True

    for item in all_items.data:
        if item.get("dispensed_quantity", 0) < item["quantity"]:
            fully_done = False
            break

    new_status = "DISPENSED" if fully_done else "PARTIALLY_DISPENSED"

    # 6. Update prescription status
    supabase.table("prescriptions").update({
        "status": new_status
    }).eq("id", prescription_id).execute()

    # 7. Log dispensation
    supabase.table("dispensations").insert({
        "prescription_id": prescription_id,
        "pharmacist_id": pharmacist_id,
        "dispensed_at": datetime.utcnow().isoformat(),
        "status": new_status
    }).execute()

    return {
        "message": "Dispensing successful",
        "status": new_status
    }

def reduce_stock(drug_name, pharmacy_id, quantity):
    item = supabase.table("inventory") \
        .select("*") \
        .eq("drug_name", drug_name) \
        .eq("pharmacy_id", pharmacy_id) \
        .single() \
        .execute()

    if item.data["stock"] < quantity:
        raise HTTPException(400, "Not enough stock")

    supabase.table("inventory").update({
        "stock": item.data["stock"] - quantity
    }).eq("id", item.data["id"]).execute()
