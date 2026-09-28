import json

from pydantic import ValidationError

from app.controllers.global_settings_controller import write_global_setting
from app.models.GlobalSettings import GlobalSettings
from app.requests.appearance_settings_request import AppearanceSettingsRequest
from app.resources.appearance_settings_resource import AppearanceSettingsResource

SETTINGS_KEY = "appearance"
DEFAULTS = AppearanceSettingsRequest(ui_font_size=13)


async def _saved() -> AppearanceSettingsRequest | None:
    row = await GlobalSettings.where("key", SETTINGS_KEY).first()
    if not row:
        return None
    try:
        return AppearanceSettingsRequest.model_validate(json.loads(row.value))
    except (TypeError, ValueError, ValidationError):
        return None


async def current() -> AppearanceSettingsRequest:
    return await _saved() or DEFAULTS


async def show() -> AppearanceSettingsResource:
    return AppearanceSettingsResource((await current()).model_dump())


async def update(body: AppearanceSettingsRequest) -> AppearanceSettingsResource:
    await write_global_setting(SETTINGS_KEY, body.model_dump())
    return AppearanceSettingsResource(body.model_dump())
