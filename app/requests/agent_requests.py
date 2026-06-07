from typing import Optional

from pydantic import BaseModel


class AgentStoreRequest(BaseModel):
    """Input model for AgentCreateAction — covers all agent-creation paths."""
    name: str
    agent_type: str = "software_engineer"
    description: Optional[str] = None
    model: str = "claude-sonnet-4-6"
    system_prompt: Optional[str] = None
    flags: dict = {}
    dangerously_skip_permissions: bool = True
    plan_mode: Optional[bool] = None  # None → resolved from agent_type at creation time
    task_id: Optional[int] = None
    orchestrator_id: Optional[int] = None
    # Transient field: initial message to send after agent creation (not stored)
    message: Optional[str] = None


class AgentUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    agent_type: Optional[str] = None
    flags: Optional[dict] = None
    dangerously_skip_permissions: Optional[bool] = None
    plan_mode: Optional[bool] = None
