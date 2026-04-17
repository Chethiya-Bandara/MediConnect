from pydantic import BaseModel

# Affiliations
class AffiliationDecisionRequest(BaseModel):
    affiliation_id: str
    status: str  # APPROVED / REJECTED / REVOKED

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

# Invite doctor
class InviteDoctorRequest(BaseModel):
    doctor_email: str
    hospital_id: str