"""Global application settings — stored in the global_settings DB table."""

import json

from fastapi import Request
from fastapi.responses import JSONResponse

from app.ai import providers
from app.models.GlobalSettings import GlobalSettings

DEFAULT_SETTINGS: dict = {
    "max_agents_per_project": 10,
    "provider_models": {
        provider.slug: list(provider.default_models) for provider in providers.all()
    },
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


async def get_global_settings(request: Request):
    return JSONResponse(await read_global_settings())


async def update_global_settings(request: Request):
    body = await request.json()

    if "max_agents_per_project" in body:
        val = body["max_agents_per_project"]
        if not isinstance(val, int) or val < 1:
            return JSONResponse(
                {"error": "max_agents_per_project must be a positive integer"},
                status_code=422,
            )
        await write_global_setting("max_agents_per_project", val)

    if "provider_models" in body:
        configured = body["provider_models"]
        known = {provider.slug for provider in providers.all()}
        if not isinstance(configured, dict) or set(configured) != known:
            return JSONResponse(
                {"error": "provider_models must define every registered provider"}, status_code=422
            )
        normalized: dict[str, list[str]] = {}
        for slug, models in configured.items():
            if not isinstance(models, list):
                return JSONResponse({"error": f"Models for {slug} must be a list"}, status_code=422)
            cleaned = list(
                dict.fromkeys(
                    model.strip() for model in models if isinstance(model, str) and model.strip()
                )
            )
            if not cleaned:
                return JSONResponse(
                    {"error": f"Add at least one model for {slug}"}, status_code=422
                )
            normalized[slug] = cleaned
        await write_global_setting("provider_models", normalized)

    return JSONResponse(await read_global_settings())
