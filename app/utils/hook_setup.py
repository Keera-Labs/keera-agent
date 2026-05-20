"""
Ensures the Claude Code Stop hook is registered in ~/.claude/settings.json.
Called at app startup so users don't have to configure it manually.
"""

import json
import os

HOOK_URL = "http://localhost:8000/api/claude-stopped"
SETTINGS_PATH = os.path.expanduser("~/.claude/settings.json")


def ensure_stop_hook() -> None:
    """Merge the Stop hook into the global Claude Code settings file."""
    os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)

    settings: dict = {}
    if os.path.exists(SETTINGS_PATH):
        try:
            with open(SETTINGS_PATH) as f:
                settings = json.load(f)
        except (json.JSONDecodeError, OSError):
            settings = {}

    hooks: dict = settings.setdefault("hooks", {})
    stop_hooks: list = hooks.setdefault("Stop", [])

    # Check if our hook is already registered
    our_hook = {"type": "http", "url": HOOK_URL}
    for group in stop_hooks:
        for h in group.get("hooks", []):
            if h.get("type") == "http" and h.get("url") == HOOK_URL:
                return  # Already registered

    # Append our hook group
    stop_hooks.append({"hooks": [our_hook]})

    with open(SETTINGS_PATH, "w") as f:
        json.dump(settings, f, indent=2)

    print(f"[keera] Registered Claude Code Stop hook in {SETTINGS_PATH}")
