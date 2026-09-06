from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ComplexityModelsRequest(BaseModel):
    easy: str = Field(min_length=1)
    medium: str = Field(min_length=1)
    hard: str = Field(min_length=1)

    @field_validator("easy", "medium", "hard")
    @classmethod
    def strip_model(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("model ids must not be blank")
        return value


class GlobalSettingsUpdateRequest(BaseModel):
    max_agents_per_project: int | None = None
    provider_models: dict[str, list[str]] | None = None
    default_provider: Literal["codex", "claude"] | None = None
    complexity_models: ComplexityModelsRequest | None = None

    @field_validator("provider_models")
    @classmethod
    def validate_provider_models(cls, value: dict[str, list[str]] | None):
        if value is None:
            return value

        expected = {"codex", "claude"}
        if set(value) != expected:
            raise ValueError("provider_models must define codex and claude")

        normalized: dict[str, list[str]] = {}
        for provider, models in value.items():
            cleaned = list(dict.fromkeys(model.strip() for model in models if model.strip()))
            if not cleaned:
                raise ValueError(f"Add at least one model for {provider}")
            normalized[provider] = cleaned
        return normalized
