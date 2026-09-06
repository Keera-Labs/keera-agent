from pydantic import BaseModel, Field


class AgentCheckinRequest(BaseModel):
    """Start/stop the PM check-in scheduler and set its interval (minutes)."""

    enabled: bool
    interval_minutes: int = Field(default=5, ge=1, le=1440)
