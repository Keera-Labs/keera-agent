from pydantic import BaseModel, Field


class AgentUsageReportRequest(BaseModel):
    """Plan-limit and context usage an agent's statusline script forwards from Claude Code."""

    agent_id: int = Field(gt=0)
    session_id: str | None = Field(default=None, max_length=100)
    model: str | None = Field(default=None, max_length=100)
    five_hour_used_percentage: float | None = Field(default=None, ge=0)
    five_hour_resets_at: int | None = None
    seven_day_used_percentage: float | None = Field(default=None, ge=0)
    seven_day_resets_at: int | None = None
    context_used_percentage: float | None = Field(default=None, ge=0, le=100)
    context_window_size: int | None = Field(default=None, gt=0)
