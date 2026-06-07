from typing import Optional

from pydantic import BaseModel


class AgentStoreRequest(BaseModel):
    name: str
    agent_type: str = "software_engineer"
    description: Optional[str] = None
    model: str = "claude-sonnet-4-6"
    system_prompt: Optional[str] = None
    flags: dict = {}
    dangerously_skip_permissions: bool = True
    plan_mode: Optional[bool] = None  # resolved at runtime: True if agent_type=="pm", else False


class AgentUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    agent_type: Optional[str] = None
    flags: Optional[dict] = None
    dangerously_skip_permissions: Optional[bool] = None
    plan_mode: Optional[bool] = None
