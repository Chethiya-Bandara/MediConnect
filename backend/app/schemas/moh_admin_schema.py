from pydantic import BaseModel, field_validator, Field


class OrganizationApprovalRequest(BaseModel):
    id: str
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        normalized = (value or "").strip().lower()
        if normalized not in {"approved", "rejected", "pending", "active", "suspended"}:
            raise ValueError("Invalid organisation status")
        return normalized


class DoctorApprovalRequest(BaseModel):
    id: str
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        normalized = (value or "").strip().lower()
        if normalized not in {"approved", "rejected", "pending", "active", "suspended"}:
            raise ValueError("Invalid doctor status")
        return normalized


class SuspendRequest(BaseModel):
    target_id: str
    target_type: str
    action: str

    @field_validator("target_type")
    @classmethod
    def validate_target_type(cls, value: str) -> str:
        normalized = (value or "").strip().upper()
        if normalized not in {"USER", "ORGANIZATION"}:
            raise ValueError("Invalid target type")
        return normalized

    @field_validator("action")
    @classmethod
    def validate_action(cls, value: str) -> str:
        normalized = (value or "").strip().upper()
        if normalized not in {"SUSPEND", "ACTIVATE"}:
            raise ValueError("Invalid governance action")
        return normalized


class AnalyticsRequest(BaseModel):
    start_date: str
    end_date: str
    district: str | None = None


class OrganizationCreateRequest(BaseModel):
    name: str = Field(max_length=255)
    type: str = Field(max_length=100)
    status: str = "active"

    @field_validator("name", "type")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("This field is required")
        return cleaned

    @field_validator("status")
    @classmethod
    def validate_create_status(cls, value: str) -> str:
        normalized = (value or "").strip().lower()
        if normalized not in {"active", "approved", "pending"}:
            raise ValueError("Invalid organisation creation status")
        return normalized


class MedicineUpsertRequest(BaseModel):
    name: str
    unit: str
    wholesale_price: float = Field(..., gt=0)
    retail_price: float = Field(..., gt=0)

    @field_validator("name", "unit")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        cleaned = " ".join((value or "").replace("\xa0", " ").split())
        if not cleaned:
            raise ValueError("This field is required")
        return cleaned

    @field_validator("wholesale_price", "retail_price")
    @classmethod
    def validate_non_negative_price(cls, value: float) -> float:
        if value is None:
            raise ValueError("This field is required")
        if value < 0:
            raise ValueError("Price cannot be negative")
        return float(value)
