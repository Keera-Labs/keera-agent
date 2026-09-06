import json
import os
from urllib.parse import urlparse

from fastapi_startkit import Config

from app.utils.json_utils import atomic_write_json

# URL paths that identify keera-managed Claude hooks.
_STOP_PATH = "/api/claude-stopped"
_START_PATH = "/api/claude-started"

# Tools denied by default in every project's permissions block.
_DEFAULT_DENIED_TOOLS = ["Agent"]


class ClaudeSetupAction:
    """Upsert keera-managed hooks and permissions into a directory's .claude/settings.json.

    Writes the Stop and UserPromptSubmit hooks, with URLs derived from the
    configured app_url, and enforces the default permissions.deny policy. All
    other settings keys are preserved and keera-managed entries are updated in
    place, so the write is idempotent. execute() returns True only when the
    file actually changed.

    MCP server registration is intentionally out of scope — that lives in
    .mcp.json via McpSettingWriteAction (the mcp:sync command).

    Directory-scoped (not project-id-scoped like McpSettingWriteAction) because
    the same writer serves both project directories and the app's own root.
    """

    def __init__(self, directory: str):
        self.directory = directory

    @staticmethod
    def prepare(directory: str):
        return ClaudeSetupAction(directory)

    def execute(self) -> bool:
        base_url = Config.get("fastapi.app_url")

        settings_path = os.path.join(self.directory, ".claude", "settings.json")
        os.makedirs(os.path.dirname(settings_path), exist_ok=True)

        settings = self._load(settings_path)

        hooks: dict = settings.setdefault("hooks", {})
        changed = False
        changed |= self._upsert_hook(
            hooks.setdefault("Stop", []), _STOP_PATH, f"{base_url}{_STOP_PATH}"
        )
        changed |= self._upsert_hook(
            hooks.setdefault("UserPromptSubmit", []), _START_PATH, f"{base_url}{_START_PATH}"
        )

        if settings.get("defaultMode") != "acceptEdits":
            settings["defaultMode"] = "acceptEdits"
            changed = True

        changed |= self._upsert_default_deny(settings.setdefault("permissions", {}))

        if changed:
            atomic_write_json(settings_path, settings)
            print(f"[keera] Claude settings updated in {self.directory}/.claude/settings.json")

        return changed

    @staticmethod
    def _load(settings_path: str) -> dict:
        if os.path.exists(settings_path):
            try:
                with open(settings_path) as f:
                    data = json.load(f)
            except (json.JSONDecodeError, OSError):
                data = {}
            if isinstance(data, dict):
                return data
        return {}

    @staticmethod
    def _upsert_default_deny(permissions: dict) -> bool:
        """Ensure every default-denied tool is listed in permissions.deny. True if changed."""
        deny: list = permissions.setdefault("deny", [])
        changed = False
        for tool in _DEFAULT_DENIED_TOOLS:
            if tool not in deny:
                deny.append(tool)
                changed = True
        return changed

    @staticmethod
    def _upsert_hook(hook_list: list, path: str, new_url: str) -> bool:
        """Update an existing keera hook (matched by URL path) in place, else append. True if changed."""
        for group in hook_list:
            for h in group.get("hooks", []):
                if urlparse(h.get("url", "")).path == path:
                    if h["url"] == new_url:
                        return False
                    h["url"] = new_url
                    return True
        hook_list.append({"hooks": [{"type": "http", "url": new_url}]})
        return True
