from typing import Any, Literal

from pydantic import BaseModel, StrictBool


class GlobalSettingsUpdateRequest(BaseModel):
    max_agents_per_project: Any = None
    provider_models: Any = None
    default_provider: Any = None
    complexity_models: Any = None
    complexity_thinking_levels: Any = None
    enforce_default_provider: StrictBool | None = None
    provider_distribution: Literal["default", "even"] | None = None
    distribution_providers: list[str] | None = None
