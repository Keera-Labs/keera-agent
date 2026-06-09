"""Global application settings — stored in the global_settings DB table."""

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.GlobalSettings import GlobalSettings

DEFAULT_SETTINGS: dict = {
    "max_agents_per_project": 10,
}


async def read_global_settings() -> dict:
    """Return current global settings merged with defaults for any missing keys."""
    rows = await GlobalSettings.all()
    result = dict(DEFAULT_SETTINGS)
    for row in rows:
        key = row.key
        if key == "max_agents_per_project":
            try:
                result[key] = int(row.value)
            except (TypeError, ValueError):
                pass
    return result


async def write_global_setting(key: str, value) -> None:
    """Upsert a single setting by key."""
    existing = await GlobalSettings.where("key", key).first()
    if existing:
        existing.value = str(value)
        await existing.save()
    else:
        await GlobalSettings.create({"key": key, "value": str(value)})


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

    return JSONResponse(await read_global_settings())
