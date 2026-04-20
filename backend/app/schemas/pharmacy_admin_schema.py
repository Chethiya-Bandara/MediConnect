from pydantic import BaseModel, EmailStr, Field, field_validator

class InventoryItemRequest(BaseModel):
    medicine_name: str
    stock_quantity: int
    unit_price: float

class UpdateInventoryRequest(BaseModel):
    id: str
    stock_quantity: int = Field(ge=0)
    unit_price: float = Field(ge=0)

class CreateMedicineRequest(BaseModel):
    pharmacy_id: str
    medicine_id: int | None = None
    medicine_name: str
    stock_quantity: int = Field(ge=0)
    unit_price: float | None = Field(default=None, ge=0)


class CreatePharmacyStaffRequest(BaseModel):
    pharmacy_id: str
    full_name: str = Field(min_length=3, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    license_no: str = Field(min_length=3, max_length=80)
    status: str = "active"

    @field_validator("status")
    @classmethod
    def normalize_status(cls, value: str):
        normalized = value.strip().lower()
        if normalized not in {"active", "suspended"}:
            raise ValueError("Invalid staff status")
        return normalized


class UpdateStaffStatusRequest(BaseModel):
    pharmacy_id: str
    status: str

    @field_validator("status")
    @classmethod
    def normalize_status(cls, value: str):
        normalized = value.strip().lower()
        if normalized not in {"active", "suspended"}:
            raise ValueError("Invalid staff status")
        return normalized
