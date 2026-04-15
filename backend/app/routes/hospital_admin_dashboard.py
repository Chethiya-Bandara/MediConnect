from fastapi import APIRouter, HTTPException
from datetime import datetime
from app.config.supabase import supabase_admin
from app.schemas.hospital_admin_schema import *

router = APIRouter(prefix="/hospital-admin", tags=["hospital-admin-dashboard"])

# Approve / reject affiliation
@router.put("/affiliations/decision")
def decide_affiliation(data: AffiliationDecisionRequest):

    supabase_admin.table("doctor_affiliations").update({
        "status": data.status,
        "approved_at": datetime.utcnow().isoformat()
    }).eq("id", data.affiliation_id).execute()

    return {"message": f"Affiliation {data.status}"}

# Revoke doctor affiliation
@router.put("/affiliations/revoke")
def revoke_affiliation(data: RevokeAffiliationRequest):

    supabase_admin.table("doctor_affiliations").update({
        "status": "REVOKED"
    }).eq("id", data.affiliation_id).execute()

    return {"message": "Affiliation revoked"}

# Create availability slot for a doctor
@router.post("/availability")
def create_availability(data: AvailabilitySlotRequest):

    supabase_admin.table("availability_slots").insert({
        "doctor_id": data.doctor_id,
        "hospital_id": data.hospital_id,
        "day_of_week": data.day_of_week,
        "start_time": data.start_time,
        "end_time": data.end_time,
        "created_at": datetime.utcnow().isoformat()
    }).execute()

    return {"message": "Availability slot created"}

# View availability
@router.get("/availability/{doctor_id}")
def get_availability(doctor_id: str):

    res = supabase_admin.table("availability_slots") \
        .select("*") \
        .eq("doctor_id", doctor_id) \
        .execute()

    return res.data

# Invite doctor
@router.post("/invite")
def invite_doctor(data: InviteDoctorRequest):

    supabase_admin.table("doctor_invitations").insert({
        "doctor_email": data.doctor_email,
        "hospital_id": data.hospital_id,
        "status": "PENDING",
        "sent_at": datetime.utcnow().isoformat()
    }).execute()

    return {"message": "Invitation sent"}

# RBAC Safeguard
def require_hospital_admin(user):
    if user["role"] != "hospital_admin":
        raise HTTPException(403, "Access denied")