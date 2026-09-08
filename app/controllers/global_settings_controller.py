"""Global application settings — stored in the global_settings DB table."""

import json

from fastapi.responses import JSONResponse

from app.ai import providers
from app.models.GlobalSettings import GlobalSettings
from app.requests.global_settings_request import GlobalSettingsUpdateRequest
from app.resources.global_settings_resource import GlobalSettingsResource

DEFAULT_SETTINGS: dict = {
    "max_agents_per_project": 10,
    "provider_models": {
        provider.slug: list(provider.default_models) for provider in providers.all()
    },
}

DEFAULT_PROVIDER = "codex"
DEFAULT_COMPLEXITY_MODELS = {
    "codex": {"easy": "gpt-5.6-luna", "medium": "gpt-5.6-terra", "hard": "gpt-5.6-sol"},
    "claude": {"easy": "claude-sonnet-5", "medium": "claude-opus-5", "hard": "claude-fable-5"},
}


def _provider_payload(model_settings: dict[str, list[str]]) -> list[dict]:
    return [
        {
            "slug": provider.slug,
            "name": provider.display_name,
            "models": model_settings.get(provider.slug, list(provider.default_models)),
        }
        for provider in providers.all()
    ]


async def read_global_settings() -> dict:
    """Return current global settings merged with defaults for any missing keys."""
    rows = await GlobalSettings.all()
    result = {
        "max_agents_per_project": DEFAULT_SETTINGS["max_agents_per_project"],
        "provider_models": dict(DEFAULT_SETTINGS["provider_models"]),
        "default_provider": DEFAULT_PROVIDER,
    }
    for row in rows:
        key = row.key
        if key == "max_agents_per_project":
            try:
                result[key] = int(row.value)
            except (TypeError, ValueError):
                pass
        elif key == "provider_models":
            try:
                stored = json.loads(row.value)
                if isinstance(stored, dict):
                    result[key] = {
                        slug: models
                        for slug, models in stored.items()
                        if isinstance(slug, str)
                        and isinstance(models, list)
                        and all(isinstance(model, str) for model in models)
                    }
            except (TypeError, ValueError, json.JSONDecodeError):
                pass
        elif key == "default_provider" and row.value in {"codex", "claude"}:
            result[key] = row.value
        elif key == "complexity_models":
            try:
                stored = json.loads(row.value)
                if isinstance(stored, dict) and all(
                    isinstance(stored.get(level), str) for level in ("easy", "medium", "hard")
                ):
                    result[key] = {level: stored[level] for level in ("easy", "medium", "hard")}
            except (TypeError, ValueError, json.JSONDecodeError):
                pass

    configured_models = result["provider_models"].get(result["default_provider"], [])
    defaults = DEFAULT_COMPLEXITY_MODELS[result["default_provider"]]
    saved_complexity = result.get("complexity_models", {})
    result["complexity_models"] = {
        level: saved_complexity.get(level)
        if saved_complexity.get(level) in configured_models
        else defaults[level]
        if defaults[level] in configured_models
        else configured_models[0]
        for level in ("easy", "medium", "hard")
    }
    result["providers"] = _provider_payload(result["provider_models"])
    return result


async def write_global_setting(key: str, value) -> None:
    """Upsert a single setting by key."""
    existing = await GlobalSettings.where("key", key).first()
    if existing:
        existing.value = json.dumps(value) if isinstance(value, (dict, list)) else str(value)
        await existing.save()
    else:
        stored = json.dumps(value) if isinstance(value, (dict, list)) else str(value)
        await GlobalSettings.create({"key": key, "value": stored})


async def provider_model_is_configured(provider: str, model: str) -> bool:
    try:
        providers.get(provider)
    except ValueError:
        return False
    settings = await read_global_settings()
    return model in settings["provider_models"].get(provider, [])


async def index() -> GlobalSettingsResource:
    return GlobalSettingsResource(await read_global_settings())


async def update(body: GlobalSettingsUpdateRequest):
    from app.actions.global_settings_update_action import GlobalSettingsUpdateAction

    try:
        settings = await GlobalSettingsUpdateAction.prepare(body).execute()
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=422)
    return GlobalSettingsResource(settings)
