import re
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, field_validator

_TIME_RE = re.compile(r"^\d{2}:\d{2}$")
_VALID_DAYS = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}

# Affiliations
class AffiliationDecisionRequest(BaseModel):
    affiliation_id: str
    status: Literal["approved", "rejected", "revoked"]

# Revoke affiliations
class RevokeAffiliationRequest(BaseModel):
    affiliation_id: str

# Availability slot
class AvailabilitySlotRequest(BaseModel):
    doctor_id: str
    hospital_id: str
    day_of_week: str
    start_time: str
    end_time: str

    @field_validator("day_of_week")
    @classmethod
    def validate_day(cls, v: str) -> str:
        normalized = v.strip().lower()
        if normalized not in _VALID_DAYS:
            raise ValueError("day_of_week must be a full weekday name (e.g. monday)")
        return normalized

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time(cls, v: str) -> str:
        if not _TIME_RE.match(v):
            raise ValueError("Time must be in HH:MM format")
        hour, minute = int(v[:2]), int(v[3:])
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError("Time value is out of range")
        return v

# Invite doctor
class InviteDoctorRequest(BaseModel):
    doctor_email: EmailStr
    hospital_id: Optional[str] = None
