from datetime import date, datetime
import re
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator, model_validator

NIC_PATTERN = re.compile(r"^(?:\d{9}[VvXx]|\d{12})$")
SUPPORTED_ROLES = {
    "patient",
    "doctor",
    "health_ministry_admin",
    "hospital_admin",
    "pharmacist",
    "pharmacy_admin",
}

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    role: str
    dhid: Optional[str] = None

    fullName: Optional[str] = None
    nic: Optional[str] = None
    dob: Optional[str] = None

    specialization: Optional[str] = None
    licenseNumber: Optional[str] = None
    pharmacyId: Optional[str] = None
    hospitalId: Optional[str] = None
    parentNic: Optional[str] = None
    organisationId: Optional[str] = None
    credentialFileName: Optional[str] = None
    credentialFileSize: Optional[int] = None
    credentialFileType: Optional[str] = None

    @field_validator("role")
    @classmethod
    def normalize_role(cls, value: str):
        normalized = value.strip().lower()
        if normalized not in SUPPORTED_ROLES:
            raise ValueError("Invalid role")
        return normalized

    @field_validator("nic", "parentNic")
    @classmethod
    def validate_nic(cls, value: Optional[str]):
        if value is None or not value.strip():
            return None
        cleaned = value.strip()
        if not NIC_PATTERN.match(cleaned):
            raise ValueError("NIC format is invalid")
        return cleaned

    @field_validator("dob")
    @classmethod
    def validate_dob(cls, value: Optional[str]):
        if value is None or not value.strip():
            return None

        try:
            parsed = datetime.fromisoformat(value).date()
        except ValueError as exc:
            raise ValueError("Date of birth is invalid") from exc

        if parsed > date.today():
            raise ValueError("Date of birth cannot be in the future")

        return value

    @field_validator("credentialFileSize")
    @classmethod
    def validate_credential_file_size(cls, value: Optional[int]):
        if value is None:
            return None
        if value > 5 * 1024 * 1024:
            raise ValueError("Credential file exceeds 5MB")
        return value

    @field_validator("credentialFileType")
    @classmethod
    def validate_credential_file_type(cls, value: Optional[str]):
        if value is None or not value.strip():
            return None
        allowed = {"application/pdf", "image/jpeg", "image/png"}
        if value not in allowed:
            raise ValueError("Credential file type is not supported")
        return value

    @model_validator(mode="after")
    def validate_role_requirements(self):
        if self.fullName is None or len(self.fullName.strip()) < 3:
            raise ValueError("Full name must be at least 3 characters")

        role = self.role
        dob_value = (
            datetime.fromisoformat(self.dob).date()
            if self.dob
            else None
        )

        if role == "patient":
            if not self.nic:
                raise ValueError("NIC is required for patients")
            if dob_value is None:
                raise ValueError("Date of birth is required for patients")
            age = date.today().year - dob_value.year - (
                (date.today().month, date.today().day)
                < (dob_value.month, dob_value.day)
            )
            if age < 18 and not self.parentNic:
                raise ValueError("Guardian NIC is required for underage patients")

        if role == "doctor":
            if not self.specialization or not self.specialization.strip():
                raise ValueError("Specialization is required for doctors")
            if not self.licenseNumber or not self.licenseNumber.strip():
                raise ValueError("License number is required for doctors")

        if role == "pharmacist":
            if not self.pharmacyId or not self.pharmacyId.strip():
                raise ValueError("Pharmacy ID is required for pharmacists")

        if role in {"hospital_admin", "pharmacy_admin"} and not (
            self.organisationId and self.organisationId.strip()
        ):
            raise ValueError("Organisation ID is required for this role")

        if role != "patient" and self.credentialFileName:
            if self.credentialFileSize is None or self.credentialFileType is None:
                raise ValueError("Credential file metadata is incomplete")

        return self

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class PasswordResetRequest(BaseModel):
    email: EmailStr
