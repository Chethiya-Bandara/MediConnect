from typing import Optional

from pydantic import BaseModel, Field, model_validator

class DispenseItem(BaseModel):
    id: int | str
    quantity: int = Field(ge=1)

class DispenseRequest(BaseModel):
    pharmacy_id: Optional[int] = None
    items: list[DispenseItem]

    @model_validator(mode="after")
    def require_items(self):
        if not self.items:
            raise ValueError("At least one dispense item is required")
        return self
