import json
import os

from app.utils.hook_setup import BASE_URL
from app.utils.json_utils import atomic_write_json

# URL path fragments that identify keera-managed Claude hooks.
_STOP_PATH = "/api/claude-stopped"
_START_PATH = "/api/claude-started"


class ClaudeHookAction:
    """Upsert keera-managed Claude hooks + MCP entry into a directory's .claude/settings.json.

    Writes the Stop hook, the UserPromptSubmit hook, and the keera-agent MCP
    server entry, with URLs derived from the app URL. All other settings keys
    are preserved and keera-managed hook URLs are updated in place, so the write
    is idempotent. execute() returns True only when the file actually changed.

    Directory-scoped (not project-id-scoped like McpSettingWriteAction) because
    the same writer serves both project directories and the app's own root.
    """

    def __init__(
        self, directory: str, base_url: str | None = None, project_path: str | None = None
    ):
        self.directory = directory
        self.base_url = base_url or BASE_URL
        self.project_path = project_path

    @staticmethod
    def prepare(directory: str, base_url: str | None = None, project_path: str | None = None):
        return ClaudeHookAction(directory, base_url=base_url, project_path=project_path)

    def execute(self) -> bool:
        settings_path = os.path.join(self.directory, ".claude", "settings.json")
        os.makedirs(os.path.dirname(settings_path), exist_ok=True)

        settings = self._load(settings_path)

        hooks: dict = settings.setdefault("hooks", {})
        changed = False
        changed |= self._upsert_hook(
            hooks.setdefault("Stop", []), _STOP_PATH, f"{self.base_url}{_STOP_PATH}"
        )
        changed |= self._upsert_hook(
            hooks.setdefault("UserPromptSubmit", []), _START_PATH, f"{self.base_url}{_START_PATH}"
        )

        # Register MCP server with X-Project-Path so the server scopes to the
        # project root; project_path overrides directory for agent subdirs.
        mcp_servers: dict = settings.setdefault("mcpServers", {})
        desired_mcp = {
            "type": "http",
            "url": f"{self.base_url}/mcp",
            "headers": {"X-Project-Path": self.project_path or self.directory},
        }
        if mcp_servers.get("keera-agent") != desired_mcp:
            mcp_servers["keera-agent"] = desired_mcp
            changed = True

        if settings.get("defaultMode") != "acceptEdits":
            settings["defaultMode"] = "acceptEdits"
            changed = True

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
    def _upsert_hook(hook_list: list, path_fragment: str, new_url: str) -> bool:
        """Update an existing keera hook's URL in place, else append one. True if changed."""
        for group in hook_list:
            for h in group.get("hooks", []):
                if h.get("type") == "http" and path_fragment in h.get("url", ""):
                    if h["url"] == new_url:
                        return False
                    h["url"] = new_url
                    return True
        hook_list.append({"hooks": [{"type": "http", "url": new_url}]})
        return True
