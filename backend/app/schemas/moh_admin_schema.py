from pydantic import BaseModel

# Approve organization
class OrganizationApprovalRequest(BaseModel):
    id: str
    status: str  # approved / rejected

# Approve Doctor Affiliation
class DoctorApprovalRequest(BaseModel):
    id: str
    status: str

# Account suspensions
class SuspendRequest(BaseModel):
    target_id: str
    target_type: str  # USER / ORGANIZATION
    action: str       # SUSPEND / ACTIVATE

# Get analytics
class AnalyticsRequest(BaseModel):
    start_date: str
    end_date: str
    district: str | None = None