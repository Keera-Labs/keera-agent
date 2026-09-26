import json
import os
from urllib.parse import urlparse

from fastapi_startkit import Config

from app.utils.json_utils import atomic_write_json

# URL paths that identify keera-managed Claude hooks.
_STOP_PATH = "/api/claude-stopped"
_START_PATH = "/api/claude-started"
_AGENT_EVENT_PATH = "/api/agent-hook-events"

# Set in each agent's PTY and echoed back by its hooks, so an event can be attributed to
# the agent that raised it even when several agents share one project directory.
AGENT_ID_ENV = "KEERA_AGENT_ID"
AGENT_ID_HEADER = "X-Keera-Agent-Id"


def agent_env(agent_id: int) -> dict:
    """The environment for an agent's PTY."""
    return {**os.environ, AGENT_ID_ENV: str(agent_id)}


class ClaudeHookAction:
    """Upsert keera-managed Claude hooks into a directory's .claude/settings.json.

    Writes the Stop and UserPromptSubmit hooks, plus the agent-status hooks
    (AskUserQuestion, permission prompts, and the tool/prompt events that clear
    them), with URLs derived from the configured app_url. All other settings keys
    and user-defined hooks are preserved; keera-managed hooks (matched by URL path)
    are updated in place, so the write is idempotent. execute() returns True only
    when the file actually changed.

    MCP server registration is intentionally out of scope — that lives in
    .mcp.json via McpSettingWriteAction (the mcp:sync command).

    Directory-scoped (not project-id-scoped like McpSettingWriteAction) because
    the same writer serves both project directories and the app's own root.
    """

    def __init__(self, directory: str):
        self.directory = directory

    @staticmethod
    def prepare(directory: str):
        return ClaudeHookAction(directory)

    def execute(self) -> bool:
        base_url = Config.get("fastapi.app_url")

        settings_path = os.path.join(self.directory, ".claude", "settings.json")
        os.makedirs(os.path.dirname(settings_path), exist_ok=True)

        settings = self._load(settings_path)

        hooks: dict = settings.setdefault("hooks", {})
        changed = False
        for event, path, matcher, attributed in self._managed_hooks():
            desired = self._http_hook(f"{base_url}{path}", attributed)
            changed |= self._upsert_hook(hooks.setdefault(event, []), path, desired, matcher)

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
    def _managed_hooks() -> list[tuple[str, str, str | None, bool]]:
        """(event, url path, matcher, sends the agent-id header) for every keera hook."""
        return [
            ("Stop", _STOP_PATH, None, True),
            ("UserPromptSubmit", _START_PATH, None, False),
            ("UserPromptSubmit", _AGENT_EVENT_PATH, None, True),
            ("PreToolUse", _AGENT_EVENT_PATH, "AskUserQuestion", True),
            ("PostToolUse", _AGENT_EVENT_PATH, None, True),
            ("Notification", _AGENT_EVENT_PATH, "permission_prompt|elicitation_dialog", True),
        ]

    @staticmethod
    def _http_hook(url: str, attributed: bool) -> dict:
        hook: dict = {"type": "http", "url": url}
        if attributed:
            hook["headers"] = {AGENT_ID_HEADER: f"${AGENT_ID_ENV}"}
            hook["allowedEnvVars"] = [AGENT_ID_ENV]
        return hook

    @staticmethod
    def _upsert_hook(hook_list: list, path: str, desired: dict, matcher: str | None) -> bool:
        """Sync the keera hook matched by URL path to `desired`, else append it. True if changed."""
        for group in hook_list:
            for h in group.get("hooks", []):
                if urlparse(h.get("url", "")).path != path:
                    continue
                changed = h != desired
                if changed:
                    h.clear()
                    h.update(desired)
                if group.get("matcher") != matcher:
                    if matcher is None:
                        group.pop("matcher", None)
                    else:
                        group["matcher"] = matcher
                    changed = True
                return changed
        group: dict = {"matcher": matcher} if matcher else {}
        group["hooks"] = [dict(desired)]
        hook_list.append(group)
        return True
