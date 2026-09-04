from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.ai import providers
from app.constant.agent_types import ALLOWED_AGENT_TYPES


class AgentTemplateStoreRequest(BaseModel):
    name: str
    description: Optional[str] = None
    agent_type: str = "software_engineer"
    provider: str = "codex"
    model: str = "gpt-5.6-terra"
    system_prompt: Optional[str] = None
    flags: dict = Field(default_factory=dict)
    permissions_allow: list[str] = Field(default_factory=list)
    permissions_deny: list[str] = Field(default_factory=list)
    dangerously_skip_permissions: bool = True
    plan_mode: bool = False

    @field_validator("name", "model")
    @classmethod
    def _not_blank(cls, value: str, info) -> str:
        value = value.strip()
        if not value:
            raise ValueError(f"{info.field_name} must not be empty")
        return value

    @field_validator("provider")
    @classmethod
    def _known_provider(cls, value: str) -> str:
        value = value.strip()
        providers.get(value)
        return value

    @field_validator("agent_type")
    @classmethod
    def _known_agent_type(cls, value: str) -> str:
        if value not in ALLOWED_AGENT_TYPES:
            raise ValueError(f"invalid agent_type; allowed: {sorted(ALLOWED_AGENT_TYPES)}")
        return value


class AgentTemplateUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    agent_type: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    flags: Optional[dict] = None
    permissions_allow: Optional[list[str]] = None
    permissions_deny: Optional[list[str]] = None
    dangerously_skip_permissions: Optional[bool] = None
    plan_mode: Optional[bool] = None

    @field_validator("name", "model")
    @classmethod
    def _not_blank_if_set(cls, value: Optional[str], info) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError(f"{info.field_name} must not be empty")
        return value

    @field_validator("provider")
    @classmethod
    def _known_provider_if_set(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        providers.get(value)
        return value

    @field_validator("agent_type")
    @classmethod
    def _known_agent_type_if_set(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value not in ALLOWED_AGENT_TYPES:
            raise ValueError(f"invalid agent_type; allowed: {sorted(ALLOWED_AGENT_TYPES)}")
        return value
