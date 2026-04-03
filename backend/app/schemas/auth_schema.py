from pydantic import BaseModel, EmailStr
from typing import Optional

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    role: str

    fullName: Optional[str] = None
    nic: Optional[str] = None
    dob: Optional[str] = None

    specialization: Optional[str] = None
    licenseNumber: Optional[str] = None
    pharmacyId: Optional[str] = None
    parentNic: Optional[str] = None
    organisationId: Optional[str] = None

class LoginRequest(BaseModel):
    email: EmailStr
    password: str