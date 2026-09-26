import json

from pydantic import ValidationError

from app.controllers.global_settings_controller import write_global_setting
from app.models.GlobalSettings import GlobalSettings
from app.requests.editor_settings_request import EditorSettingsRequest
from app.resources.editor_settings_resource import EditorSettingsResource

SETTINGS_KEY = "editor"
# Matches the font stack the editor used before it was configurable.
DEFAULTS = EditorSettingsRequest(font_family="dank-mono", font_size=13)


async def _saved() -> EditorSettingsRequest | None:
    row = await GlobalSettings.where("key", SETTINGS_KEY).first()
    if not row:
        return None
    try:
        return EditorSettingsRequest.model_validate(json.loads(row.value))
    except (TypeError, ValueError, ValidationError):
        return None


async def show() -> EditorSettingsResource:
    saved = await _saved()
    # `customized` lets the terminal keep its own size until the user picks one.
    return EditorSettingsResource({**(saved or DEFAULTS).model_dump(), "customized": saved is not None})


async def update(body: EditorSettingsRequest) -> EditorSettingsResource:
    await write_global_setting(SETTINGS_KEY, body.model_dump())
    return EditorSettingsResource({**body.model_dump(), "customized": True})
