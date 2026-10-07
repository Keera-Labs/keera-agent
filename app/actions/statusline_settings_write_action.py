import json
import os
import shlex
import sys
from pathlib import Path

from fastapi_startkit import Config

from app.utils.json_utils import atomic_write_json

APP_ROOT = Path(__file__).resolve().parents[2]
STATUSLINE_SCRIPT = APP_ROOT / "app" / "statusline" / "keera_statusline.py"
STATUSLINE_SETTINGS = APP_ROOT / "storage" / "claude" / "statusline-settings.json"
REPORT_PATH = "/api/agent-usage-reports"


def statusline_settings_file() -> str | None:
    """The `claude --settings` file for agents, once the app has written it at boot."""
    return str(STATUSLINE_SETTINGS) if STATUSLINE_SETTINGS.is_file() else None


class StatuslineSettingsWriteAction:
    """Write the settings file that gives Keera-launched Claude agents Keera's statusline.

    It is passed per session with `--settings`, so ~/.claude/settings.json (and any
    statusline another tool installed there) is never modified; the script chains to
    that statusline instead. execute() returns True only when the file changed.
    """

    def __init__(self, path: Path = STATUSLINE_SETTINGS):
        self.path = path

    def execute(self) -> bool:
        url = f"{Config.get('fastapi.app_url')}{REPORT_PATH}"
        command = shlex.join([sys.executable, str(STATUSLINE_SCRIPT), url])
        desired = {"statusLine": {"type": "command", "command": command, "padding": 0}}

        try:
            with open(self.path) as handle:
                if json.load(handle) == desired:
                    return False
        except (OSError, ValueError):
            pass
        os.makedirs(self.path.parent, exist_ok=True)
        atomic_write_json(str(self.path), desired)
        return True
