from typing import Optional

from pydantic import BaseModel, field_validator, model_validator

from app.constant.agent_types import ALLOWED_AGENT_TYPES
from app.constant.complexity import TaskComplexity


class AgentStoreRequest(BaseModel):
    """Input model for AgentCreateAction — covers all agent-creation paths."""

    name: str
    agent_type: str = "software_engineer"
    description: Optional[str] = None
    model: str = "claude-opus-4-8"
    system_prompt: Optional[str] = None
    flags: dict = {}
    dangerously_skip_permissions: bool = True
    plan_mode: Optional[bool] = None  # None → defaults to False (only on when explicitly set)
    task_id: Optional[int] = None
    orchestrator_id: Optional[int] = None
    # Transient field (not stored): initial message to send after creation.
    message: Optional[str] = None
    # Required: the task complexity drives the model. It is the intent, so it
    # always wins over any explicit `model`.
    complexity: TaskComplexity

    @field_validator("name", "model")
    @classmethod
    def _not_blank(cls, v: str, info) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError(f"{info.field_name} must not be empty")
        return v

    @model_validator(mode="after")
    def _complexity_selects_model(self):
        self.model = self.complexity.model()
        return self

    @field_validator("agent_type")
    @classmethod
    def _known_agent_type(cls, v: str) -> str:
        if v not in ALLOWED_AGENT_TYPES:
            raise ValueError(f"invalid agent_type; allowed: {sorted(ALLOWED_AGENT_TYPES)}")
        return v


class AgentUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    agent_type: Optional[str] = None
    flags: Optional[dict] = None
    dangerously_skip_permissions: Optional[bool] = None
    plan_mode: Optional[bool] = None

    @field_validator("name", "model")
    @classmethod
    def _not_blank_if_set(cls, v: Optional[str], info) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError(f"{info.field_name} must not be empty")
        return v

    @field_validator("agent_type")
    @classmethod
    def _known_agent_type_if_set(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ALLOWED_AGENT_TYPES:
            raise ValueError(f"invalid agent_type; allowed: {sorted(ALLOWED_AGENT_TYPES)}")
        return v
