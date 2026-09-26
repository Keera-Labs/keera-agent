from typing import Any

from pydantic import BaseModel, StrictBool


class GlobalSettingsUpdateRequest(BaseModel):
    max_agents_per_project: Any = None
    provider_models: Any = None
    default_provider: Any = None
    complexity_models: Any = None
    enforce_default_provider: StrictBool | None = None
