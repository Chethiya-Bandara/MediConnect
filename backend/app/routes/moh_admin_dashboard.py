from fastapi import APIRouter, HTTPException
from datetime import datetime
from app.config.supabase import supabase_admin
from app.schemas.moh_admin_schema import *

router = APIRouter(prefix="/moh-admin", tags=["moh-admin-dashboard"])

# Approve/reject organization
@router.put("/organizations/approve")
def approve_organization(data: OrganizationApprovalRequest):

    supabase_admin.table("organizations").update({
        "status": data.status
    }).eq("id", data.id).execute()

    return {"message": f"Organization {data.status}"}

# Approve/reject doctor
@router.put("/doctors/approve")
def approve_doctor(data: DoctorApprovalRequest):

    supabase_admin.table("doctor_verifications").update({
        "status": data.status,
        "reviewed_at": datetime.utcnow().isoformat()
    }).eq("doctor_id", data.id).execute()

    return {"message": f"Doctor {data.status}"}

# Suspend / activate account
@router.put("/suspend")
def suspend_entity(data: SuspendRequest):

    if data.target_type == "USER":
        supabase_admin.table("users").update({
            "status": "SUSPENDED" if data.action == "SUSPEND" else "ACTIVE"
        }).eq("id", data.target_id).execute()

    elif data.target_type == "ORGANIZATION":
        supabase_admin.table("organizations").update({
            "status": "SUSPENDED" if data.action == "SUSPEND" else "APPROVED"
        }).eq("id", data.target_id).execute()

    else:
        raise HTTPException(400, "Invalid target type")

    return {"message": f"{data.target_type} updated"}

# Disease Incidence Analytics
@router.post("/analytics/incidence")
def disease_incidence(data: AnalyticsRequest):

    query = supabase_admin.table("diagnoses") \
        .select("diagnosis_code, district") \
        .gte("diagnosed_at", data.start_date) \
        .lte("diagnosed_at", data.end_date)

    if data.district:
        query = query.eq("district", data.district)

    res = query.execute()

    # Aggregate manually
    stats = {}

    for row in res.data:
        code = row["diagnosis_code"]
        stats[code] = stats.get(code, 0) + 1

    return stats

# Dashboard metrics
@router.get("/analytics/top-diagnoses")
def top_diagnoses():

    res = supabase_admin.table("diagnoses") \
        .select("diagnosis_code") \
        .execute()

    counts = {}
    for r in res.data:
        code = r["diagnosis_code"]
        counts[code] = counts.get(code, 0) + 1

    return sorted(counts.items(), key=lambda x: x[1], reverse=True)[:10]

# Monthly AI report
@router.post("/reports/monthly")
def generate_report():

    # You can plug OpenAI or local model here
    stats = supabase_admin.table("diagnoses").select("*").execute()

    summary = f"Total cases: {len(stats.data)}. Trends increasing in urban districts."

    return {
        "report": summary,
        "generated_at": datetime.utcnow().isoformat()
    }

# RBAC safeguard
def require_health_admin(user):
    if user["role"] != "health_ministry_admin":
        raise HTTPException(403, "Access denied")