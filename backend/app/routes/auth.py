from fastapi import APIRouter, Header, HTTPException
from app.config.supabase import supabase, supabase_admin
from app.schemas.auth_schema import RegisterRequest, LoginRequest
from app.utils.helpers import hash_nic, generate_dhid
from supabase_auth.errors import AuthApiError
from typing import Optional

router = APIRouter()

@router.post("/register")
def register(user: RegisterRequest):

    role = user.role.lower()
    auth_res = supabase.auth.sign_up({
        "email": user.email,
        "password": user.password
    })

    if not auth_res.user:
        raise HTTPException(400, "Auth failed")

    user_id = auth_res.user.id

    try:
        # users table
        supabase.table("users").insert({
            "id": user_id,
            "email": user.email,
            "role": role
        }).execute()

        # ROLE LOGIC
        if role == "patient":
            supabase.table("patients").insert({
                "user_id": user_id,
                "nic": hash_nic(user.nic),
                "dhid": generate_dhid()
            }).execute()

        elif role == "doctor":
            supabase.table("doctors").insert({
                "user_id": user_id,
                "slmc_number": user.licenseNumber,
                "specialization": user.specialization
            }).execute()

        elif role == "pharmacist":
            supabase.table("pharmacists").insert({
                "user_id": user_id,
                "pharmacy_id": user.pharmacyId
            }).execute()

        elif role in ["hospital_admin", "pharmacy_admin", "health_ministry_admin"]:
            supabase.table("admin_profiles").insert({
                "user_id": user_id,
                "admin_role": role
            }).execute()

        else:
            raise HTTPException(400, "Invalid role")

    except Exception as e:
        supabase_admin.auth.admin.delete_user(user_id)
        raise HTTPException(500, str(e))

    return {"success": True, "message": "Registration successful"}


@router.post("/login")
def login(data: LoginRequest):

    res = supabase.auth.sign_in_with_password({
        "email": data.email,
        "password": data.password
    })

    if not res.session:
        raise HTTPException(401, "Invalid credentials")

    return {
        "success": True,
        "access_token": res.session.access_token,
        "user": res.user
    }


@router.get("/me")
def get_current_user(authorization: Optional[str] = Header(None)):

    if not authorization:
        raise HTTPException(status_code=401, detail="Missing token")

    try:
        token = authorization.split(" ")[1]

        user_res = supabase.auth.get_user(token)

        if not user_res or not user_res.user:
            raise HTTPException(status_code=401, detail="Invalid token")

        user_id = user_res.user.id

        db_user = supabase.table("users") \
            .select("*") \
            .eq("id", user_id) \
            .single() \
            .execute()

        return db_user.data

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))