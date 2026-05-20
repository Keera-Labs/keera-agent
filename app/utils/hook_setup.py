"""
Ensures the Claude Code Stop hook is registered in ~/.claude/settings.json.
Called at app startup so users don't have to configure it manually.
"""

import json
import os

SETTINGS_PATH = os.path.expanduser("~/.claude/settings.json")


def _is_hook_registered(hook_list: list, url: str) -> bool:
    for group in hook_list:
        for h in group.get("hooks", []):
            if h.get("type") == "http" and h.get("url") == url:
                return True
    return False


def ensure_hooks() -> None:
    """Merge the Stop and UserPromptSubmit hooks into the global Claude Code settings file."""
    from fastapi_startkit.environment import env

    base_url = env('APP_URL', 'http://localhost:8000')
    stop_url = f"{base_url}/api/claude-stopped"
    start_url = f"{base_url}/api/claude-started"

    os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)

    settings: dict = {}
    if os.path.exists(SETTINGS_PATH):
        try:
            with open(SETTINGS_PATH) as f:
                settings = json.load(f)
        except (json.JSONDecodeError, OSError):
            settings = {}

    hooks: dict = settings.setdefault("hooks", {})

    changed = False

    stop_hooks: list = hooks.setdefault("Stop", [])
    if not _is_hook_registered(stop_hooks, stop_url):
        stop_hooks.append({"hooks": [{"type": "http", "url": stop_url}]})
        changed = True
        print(f"[keera] Registered Claude Code Stop hook → {stop_url}")

    start_hooks: list = hooks.setdefault("UserPromptSubmit", [])
    if not _is_hook_registered(start_hooks, start_url):
        start_hooks.append({"hooks": [{"type": "http", "url": start_url}]})
        changed = True
        print(f"[keera] Registered Claude Code UserPromptSubmit hook → {start_url}")

    if changed:
        with open(SETTINGS_PATH, "w") as f:
            json.dump(settings, f, indent=2)
