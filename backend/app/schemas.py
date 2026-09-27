from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class MissingPersonCreate(BaseModel):
    name: str
    age: Optional[int] = None
    gender: Optional[str] = None
    height_cm: Optional[float] = None
    last_seen_location: Optional[str] = None
    last_seen_date: Optional[datetime] = None
    description: Optional[str] = None


class UnidentifiedBodyCreate(BaseModel):
    estimated_age: Optional[int] = None
    gender: Optional[str] = None
    estimated_height_cm: Optional[float] = None
    found_location: Optional[str] = None
    found_date: Optional[datetime] = None
    physical_description: Optional[str] = None