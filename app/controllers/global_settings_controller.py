"""Global application settings — stored in the global_settings DB table."""

import json

from fastapi import Request
from fastapi.responses import JSONResponse

from app.ai import providers
from app.constant.complexity import TaskComplexity
from app.models.GlobalSettings import GlobalSettings

DEFAULT_SETTINGS: dict = {
    "max_agents_per_project": 10,
    "provider_models": {
        provider.slug: list(provider.default_models) for provider in providers.all()
    },
    "default_provider": "codex",
}


def _load_json(value):
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def _resolve_complexity_models(
    saved: dict, provider_models: dict[str, list[str]]
) -> dict[str, dict[str, str]]:
    """Saved choice per provider/tier, else the built-in default, else the first configured model.

    A choice is only honoured while its model is still configured for that
    provider, so removing a model from the list never leaves a tier pointing
    at a model agent creation would reject.
    """
    resolved: dict[str, dict[str, str]] = {}
    for provider in providers.all():
        configured = provider_models.get(provider.slug, [])
        chosen = saved.get(provider.slug) if isinstance(saved.get(provider.slug), dict) else {}
        tiers: dict[str, str] = {}
        for complexity in TaskComplexity:
            default = complexity.model(provider.slug)
            for candidate in (chosen.get(complexity.value), default, *configured[:1]):
                if candidate in configured:
                    tiers[complexity.value] = candidate
                    break
            else:
                tiers[complexity.value] = default
        resolved[provider.slug] = tiers
    return resolved


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
        "default_provider": DEFAULT_SETTINGS["default_provider"],
    }
    saved_complexity_models: dict = {}
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
        elif key == "default_provider":
            if row.value in {provider.slug for provider in providers.all()}:
                result[key] = row.value
        elif key == "complexity_models":
            stored = _load_json(row.value)
            if isinstance(stored, dict):
                saved_complexity_models = stored
    result["providers"] = _provider_payload(result["provider_models"])
    result["complexity_models"] = _resolve_complexity_models(
        saved_complexity_models, result["provider_models"]
    )
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


async def complexity_model(provider: str, complexity: TaskComplexity) -> str:
    settings = await read_global_settings()
    return settings["complexity_models"][provider][TaskComplexity(complexity).value]


async def get_global_settings(request: Request):
    return JSONResponse(await read_global_settings())


async def update_global_settings(request: Request):
    body = await request.json()
    pending: dict = {}

    if "max_agents_per_project" in body:
        val = body["max_agents_per_project"]
        if not isinstance(val, int) or val < 1 or val > 100:
            return JSONResponse(
                {"error": "max_agents_per_project must be an integer between 1 and 100"},
                status_code=422,
            )
        pending["max_agents_per_project"] = val

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
        pending["provider_models"] = normalized

    if "default_provider" in body:
        if body["default_provider"] not in {provider.slug for provider in providers.all()}:
            return JSONResponse({"error": "default_provider is not a registered provider"}, status_code=422)
        pending["default_provider"] = body["default_provider"]

    if "complexity_models" in body:
        provider_models = pending.get("provider_models") or (await read_global_settings())["provider_models"]
        error = _complexity_models_error(body["complexity_models"], provider_models)
        if error:
            return JSONResponse({"error": error}, status_code=422)
        pending["complexity_models"] = body["complexity_models"]

    # Written only after every field validates, so a rejected save changes nothing.
    for key, value in pending.items():
        await write_global_setting(key, value)

    return JSONResponse(await read_global_settings())


def _complexity_models_error(value, provider_models: dict[str, list[str]]) -> str | None:
    if not isinstance(value, dict):
        return "complexity_models must map each provider to its easy/medium/hard models"
    tiers = {complexity.value for complexity in TaskComplexity}
    for slug, chosen in value.items():
        if slug not in provider_models:
            return f"Unknown provider '{slug}' in complexity_models"
        if not isinstance(chosen, dict) or set(chosen) != tiers:
            return f"complexity_models for {slug} must set easy, medium and hard"
        for complexity, model in chosen.items():
            if model not in provider_models[slug]:
                return f"Model '{model}' is not configured for {slug} ({complexity})"
    return None
