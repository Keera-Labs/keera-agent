from pydantic import BaseModel, Field


class RemoteControlSettingRequest(BaseModel):
    enabled: bool = Field(strict=True)
