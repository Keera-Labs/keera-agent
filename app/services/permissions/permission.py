import json
import os

from app.utils.json_utils import atomic_write_json


def _default_perms_path() -> str:
    override = os.environ.get("KEERA_DEFAULT_PERMS_PATH")
    if override:
        return override
    from fastapi_startkit.application import app

    return str(app().base_path / "storage" / "default_permissions.json")


def read_default_permissions() -> dict:
    path = _default_perms_path()
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except (ValueError, OSError):
            pass
    return {"allow": [], "deny": []}


def write_default_permissions(perms: dict) -> None:
    path = _default_perms_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    atomic_write_json(path, perms)
