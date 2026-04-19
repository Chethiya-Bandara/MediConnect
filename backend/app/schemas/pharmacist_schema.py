from typing import Optional

from pydantic import BaseModel

class DispenseItem(BaseModel):
    id: int | str
    quantity: int

class DispenseRequest(BaseModel):
    pharmacy_id: Optional[int | str] = None
    items: list[DispenseItem]
