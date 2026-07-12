"""
Env/path helpers for keera-managed Claude hooks.

The settings-writing logic lives in app/actions/claude_hook_action.py; this
module only exposes the base URL (from KEERA_APP_URL) and the app-root path
that callers pass to that action.
"""

import os

from fastapi_startkit.environment import env

BASE_URL = env("KEERA_APP_URL", "http://127.0.0.1:4545")


def app_base_dir() -> str:
    """Absolute path to the keera-agent application root (three levels up)."""
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
