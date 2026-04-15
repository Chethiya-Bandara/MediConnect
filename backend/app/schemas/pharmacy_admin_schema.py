from pydantic import BaseModel

class InventoryItemRequest(BaseModel):
    medicine_name: str
    stock_quantity: int
    unit_price: float

class UpdateInventoryRequest(BaseModel):
    id: str
    stock_quantity: int
    unit_price: float

class CreateMedicineRequest(BaseModel):
    pharmacy_id: str
    medicine_name: str
    stock_quantity: int
    unit_price: float