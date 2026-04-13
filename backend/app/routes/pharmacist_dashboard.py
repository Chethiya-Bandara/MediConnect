from fastapi import APIRouter, Depends, HTTPException
from app.config.supabase import supabase
from datetime import datetime

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
def dispense_prescription(prescription_id: str, pharmacist_id: str):

    # 1. Check prescription exists
    pres = supabase.table("prescriptions") \
        .select("*") \
        .eq("id", prescription_id) \
        .single() \
        .execute()

    if not pres.data:
        raise HTTPException(404, "Prescription not found")

    if pres.data["status"] == "DISPENSED":
        raise HTTPException(400, "Already dispensed")

    # 2. Insert dispensation record
    supabase.table("dispensations").insert({
        "prescription_id": prescription_id,
        "pharmacist_id": pharmacist_id,
        "dispensed_at": datetime.utcnow().isoformat(),
        "status": "DISPENSED"
    }).execute()

    # 3. Update prescription status
    supabase.table("prescriptions").update({
        "status": "DISPENSED"
    }).eq("id", prescription_id).execute()

    return {"message": "Prescription dispensed"}

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

#optional security feature to ensure only pharmacist can otain prescription data
def require_pharmacist(user):
    if user["role"] != "PHARMACIST":
        raise HTTPException(403, "Access denied")