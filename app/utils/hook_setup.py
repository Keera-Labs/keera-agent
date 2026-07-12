"""
Ensures Claude Code hooks and the MCP server are registered in a local
.claude/settings.json.  Writes only to the given directory — never to the
global ~/.claude/settings.json.

Called at app startup (for the keera-agent directory itself) and whenever a
new project is created (for the project's own directory).
"""

import json
import os

from fastapi_startkit.environment import env

from app.utils.json_utils import atomic_write_json

# URL path fragments that identify keera-managed hooks
_STOP_PATH = "/api/claude-stopped"
_START_PATH = "/api/claude-started"


def _upsert_hook(hook_list: list, path_fragment: str, new_url: str) -> bool:
    """
    If any existing hook entry contains path_fragment, update its URL in-place.
    Otherwise append a new entry.  Returns True if anything changed.
    """
    for group in hook_list:
        for h in group.get("hooks", []):
            if h.get("type") == "http" and path_fragment in h.get("url", ""):
                if h["url"] == new_url:
                    return False  # already correct
                h["url"] = new_url
                return True
    # No existing entry — add one
    hook_list.append({"hooks": [{"type": "http", "url": new_url}]})
    return True


def ensure_claude_settings(directory: str, base_url: str, project_path: str | None = None) -> bool:
    """
    Merge Stop hook, UserPromptSubmit hook, and MCP server entry into
    <directory>/.claude/settings.json.  Existing unrelated settings are
    preserved.  Keera-managed hook URLs are updated in-place if they changed.

    Returns True if the file was written, False if it was already current.
    """
    settings_path = os.path.join(directory, ".claude", "settings.json")
    os.makedirs(os.path.dirname(settings_path), exist_ok=True)

    settings: dict = {}
    if os.path.exists(settings_path):
        try:
            with open(settings_path) as f:
                settings = json.load(f)
        except (json.JSONDecodeError, OSError):
            settings = {}

    stop_url = f"{base_url}{_STOP_PATH}"
    start_url = f"{base_url}{_START_PATH}"
    mcp_url = f"{base_url}/mcp"

    hooks: dict = settings.setdefault("hooks", {})
    changed = False

    changed |= _upsert_hook(hooks.setdefault("Stop", []), _STOP_PATH, stop_url)
    changed |= _upsert_hook(hooks.setdefault("UserPromptSubmit", []), _START_PATH, start_url)

    # Register MCP server with X-Project-Path header so the server knows
    # which project's tasks to surface via resources/read.
    mcp_servers: dict = settings.setdefault("mcpServers", {})
    desired_mcp = {
        "type": "http",
        "url": mcp_url,
        # project_path overrides directory so agent subdirs still scope to the project root
        "headers": {"X-Project-Path": project_path or directory},
    }
    if mcp_servers.get("keera-agent") != desired_mcp:
        mcp_servers["keera-agent"] = desired_mcp
        changed = True

    if settings.get("defaultMode") != "acceptEdits":
        settings["defaultMode"] = "acceptEdits"
        changed = True

    if changed:
        atomic_write_json(settings_path, settings)
        print(f"[keera] Claude settings updated in {directory}/.claude/settings.json")

    return changed


BASE_URL = env("KEERA_APP_URL", "http://127.0.0.1:4545")


def app_base_dir() -> str:
    """Absolute path to the keera-agent application root (three levels up)."""
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def ensure_hooks() -> None:
    """Register hooks + MCP in the keera-agent app directory at startup."""
    ensure_claude_settings(app_base_dir(), BASE_URL)
