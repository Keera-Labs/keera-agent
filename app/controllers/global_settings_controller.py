"""Global application settings — stored in storage/global_settings.json."""

import json
import os

from fastapi import Request
from fastapi.responses import JSONResponse

_GLOBAL_SETTINGS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "storage",
    "global_settings.json",
)

DEFAULT_SETTINGS: dict = {
    "max_agents_per_project": 10,
}


def read_global_settings() -> dict:
    """Return current global settings, merged with defaults for any missing keys."""
    if os.path.exists(_GLOBAL_SETTINGS_PATH):
        try:
            with open(_GLOBAL_SETTINGS_PATH) as f:
                data = json.load(f)
                return {**DEFAULT_SETTINGS, **data}
        except (json.JSONDecodeError, OSError):
            pass
    return dict(DEFAULT_SETTINGS)


def write_global_settings(settings: dict) -> None:
    os.makedirs(os.path.dirname(_GLOBAL_SETTINGS_PATH), exist_ok=True)
    with open(_GLOBAL_SETTINGS_PATH, "w") as f:
        json.dump(settings, f, indent=2)
        f.write("\n")


async def get_global_settings(request: Request):
    return JSONResponse(read_global_settings())


async def update_global_settings(request: Request):
    body = await request.json()
    settings = read_global_settings()

    if "max_agents_per_project" in body:
        val = body["max_agents_per_project"]
        if not isinstance(val, int) or val < 1:
            return JSONResponse(
                {"error": "max_agents_per_project must be a positive integer"},
                status_code=422,
            )
        settings["max_agents_per_project"] = val

    write_global_settings(settings)
    return JSONResponse(settings)
