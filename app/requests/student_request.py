from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class StudentRegisterRequest(BaseModel):
    """Input model for registering a student."""
    model_config = ConfigDict(str_strip_whitespace=True)

    email: EmailStr
    password: str = Field(min_length=8)
    name: Optional[str] = None
