from pydantic import BaseModel

class DispenseItem(BaseModel):
    id: str
    quantity: int

class DispenseRequest(BaseModel):
    pharmacy_id: str
    items: list[DispenseItem]