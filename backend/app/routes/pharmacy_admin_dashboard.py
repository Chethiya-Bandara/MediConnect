from fastapi import APIRouter, HTTPException
from datetime import datetime
from app.config.supabase import supabase_admin
from app.schemas.pharmacy_admin_schema import *

router = APIRouter(prefix="/pharmacy-admin", tags=["pharmacy-admin-dashboard"])

# Add medicine
@router.post("/inventory")
def add_medicine(data: CreateMedicineRequest):

    supabase_admin.table("inventory").insert({
        "pharmacy_id": data.pharmacy_id,
        "drug_name": data.medicine_name,
        "stock_quantity": data.stock_quantity,
        "unit_price": data.unit_price,
        "created_at": datetime.utcnow().isoformat()
    }).execute()

    return {"message": "Medicine added"}

# Update stock  and price
@router.put("/inventory")
def update_inventory(data: UpdateInventoryRequest):

    supabase_admin.table("inventory").update({
        "stock_quantity": data.stock_quantity,
        "unit_price": data.unit_price,
        "updated_at": datetime.utcnow().isoformat()
    }).eq("id", data.id).execute()

    return {"message": "Inventory updated"}

# View inventory
@router.get("/inventory/{pharmacy_id}")
def get_inventory(pharmacy_id: str):

    res = supabase_admin.table("inventory") \
        .select("*") \
        .eq("pharmacy_id", pharmacy_id) \
        .execute()

    return res.data

# Delete item
@router.delete("/inventory/{item_id}")
def delete_medicine(item_id: str):

    supabase_admin.table("inventory") \
        .delete() \
        .eq("id", item_id) \
        .execute()

    return {"message": "Medicine removed"}