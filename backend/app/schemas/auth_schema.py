from datetime import date, datetime, timedelta
import re
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

NIC_PATTERN = re.compile(r"^(?:\d{9}[VvXx]|\d{12})$")
SUPPORTED_GENDERS = {"male", "female"}
SUPPORTED_ROLES = {
    "patient",
    "doctor",
    "health_ministry_admin",
    "hospital_admin",
    "pharmacist",
    "pharmacy_admin",
}


def _is_leap_year(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def _parse_nic_birth_details(nic: str):
    normalized = nic.strip().upper()
    is_old_nic = bool(re.match(r"^\d{9}[VX]$", normalized))
    is_new_nic = bool(re.match(r"^\d{12}$", normalized))

    if not is_old_nic and not is_new_nic:
        return None

    year = int(normalized[:2]) + 1900 if is_old_nic else int(normalized[:4])
    raw_day_value = int(normalized[2:5]) if is_old_nic else int(normalized[4:7])
    gender = "female" if raw_day_value > 500 else "male"
    day_of_year = raw_day_value - 500 if raw_day_value > 500 else raw_day_value
    max_days = 366 if _is_leap_year(year) else 365

    if day_of_year < 1 or day_of_year > max_days:
        return None

    birth_date = date(year, 1, 1) + timedelta(days=day_of_year - 1)
    return {
        "birth_date": birth_date,
        "gender": gender,
    }

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    role: str
    dhid: Optional[str] = None

    fullName: Optional[str] = None
    nic: Optional[str] = None
    dob: Optional[str] = None
    gender: Optional[str] = None

    specialization: Optional[str] = None
    licenseNumber: Optional[str] = None
    pharmacyId: Optional[str] = None
    hospitalId: Optional[str] = None
    parentNic: Optional[str] = None
    organisationId: Optional[str] = None
    credentialFileName: Optional[str] = Field(default=None, max_length=255)
    credentialFileSize: Optional[int] = None
    credentialFileType: Optional[str] = None

    @field_validator("role")
    @classmethod
    def normalize_role(cls, value: str):
        normalized = value.strip().lower()
        if normalized not in SUPPORTED_ROLES:
            raise ValueError("Invalid role")
        return normalized

    @field_validator("nic")
    @classmethod
    def validate_nic(cls, value: Optional[str]):
        if value is None or not value.strip():
            return None
        cleaned = value.strip()
        return cleaned

    @field_validator("parentNic")
    @classmethod
    def normalize_parent_nic(cls, value: Optional[str]):
        if value is None or not value.strip():
            return None
        return value.strip()

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

    @field_validator("gender")
    @classmethod
    def validate_gender(cls, value: Optional[str]):
        if value is None or not value.strip():
            return None

        normalized = value.strip().lower()
        if normalized not in SUPPORTED_GENDERS:
            raise ValueError("Gender is invalid")
        return normalized

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
            if dob_value is None:
                raise ValueError("Date of birth is required for patients")
            age = date.today().year - dob_value.year - (
                (date.today().month, date.today().day)
                < (dob_value.month, dob_value.day)
            )
            if age < 18 and not self.parentNic:
                raise ValueError("Guardian NIC is required for underage patients")
            if age >= 18 and not self.nic:
                raise ValueError("NIC is required for adult patients")

        if self.nic and not self.gender:
            raise ValueError("Gender is required when NIC is provided")

        should_validate_nic = True
        if role == "patient" and dob_value is not None:
            age = date.today().year - dob_value.year - (
                (date.today().month, date.today().day)
                < (dob_value.month, dob_value.day)
            )
            should_validate_nic = age >= 18

        if should_validate_nic and self.nic:
            if not NIC_PATTERN.match(self.nic):
                raise ValueError("NIC format is invalid")

        if should_validate_nic and self.nic and dob_value and self.gender:
            nic_details = _parse_nic_birth_details(self.nic)
            if nic_details is None:
                raise ValueError("NIC contains an invalid birth-date sequence")
            if nic_details["birth_date"] != dob_value:
                raise ValueError("NIC does not match the supplied date of birth")
            if nic_details["gender"] != self.gender:
                raise ValueError("NIC does not match the supplied gender")

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
    password: str = Field(min_length=1, max_length=128)


class PasswordResetRequest(BaseModel):
    email: EmailStr
