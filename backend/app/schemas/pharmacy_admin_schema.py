from pydantic import BaseModel, Field

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
    medicine_name: str
    stock_quantity: int = Field(ge=0)
    unit_price: float = Field(ge=0)