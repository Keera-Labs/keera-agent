import json
import os

from app.utils.json_utils import atomic_write_json

# This module lives one directory deeper than the old controller location, so the
# path walks up four levels (permissions → services → app → repo root) to resolve
# storage/default_permissions.json.
_DEFAULT_PERMS_PATH = os.environ.get("KEERA_DEFAULT_PERMS_PATH") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "storage",
    "default_permissions.json",
)


def read_default_permissions() -> dict:
    if os.path.exists(_DEFAULT_PERMS_PATH):
        try:
            with open(_DEFAULT_PERMS_PATH) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {"allow": [], "deny": []}


def write_default_permissions(perms: dict) -> None:
    os.makedirs(os.path.dirname(_DEFAULT_PERMS_PATH), exist_ok=True)
    atomic_write_json(_DEFAULT_PERMS_PATH, perms)
