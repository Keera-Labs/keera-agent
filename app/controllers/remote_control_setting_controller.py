"""Claude Code's "Enable Remote Control for all sessions" (/config), kept in ~/.claude.json."""

from fastapi.responses import JSONResponse

from app.requests.remote_control_setting_request import RemoteControlSettingRequest
from app.resources.remote_control_setting_resource import RemoteControlSettingResource
from app.services.claude_config import REMOTE_CONTROL_KEY, ClaudeConfig, InvalidClaudeConfig


def _resource(enabled: bool) -> RemoteControlSettingResource:
    return RemoteControlSettingResource({"enabled": enabled})


def _invalid(error: InvalidClaudeConfig) -> JSONResponse:
    return JSONResponse({"error": str(error)}, status_code=409)


async def show():
    try:
        return _resource(ClaudeConfig().get(REMOTE_CONTROL_KEY) is True)
    except InvalidClaudeConfig as error:
        return _invalid(error)


async def update(body: RemoteControlSettingRequest):
    try:
        ClaudeConfig().set(REMOTE_CONTROL_KEY, body.enabled)
    except InvalidClaudeConfig as error:
        return _invalid(error)
    return _resource(body.enabled)
