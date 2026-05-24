import json
import os
import shutil

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Project import Project

_DEFAULT_PERMS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "storage",
    "default_permissions.json",
)


def _read_project_settings(project_path: str) -> dict:
    settings_path = os.path.join(os.path.expanduser(project_path), ".claude", "settings.json")
    if os.path.exists(settings_path):
        try:
            with open(settings_path) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _write_project_settings(project_path: str, settings: dict) -> None:
    expanded = os.path.expanduser(project_path)
    settings_path = os.path.join(expanded, ".claude", "settings.json")
    os.makedirs(os.path.dirname(settings_path), exist_ok=True)
    if os.path.exists(settings_path):
        shutil.copy2(settings_path, settings_path + ".bak")
    with open(settings_path, "w") as f:
        json.dump(settings, f, indent=2)
        f.write("\n")


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
    with open(_DEFAULT_PERMS_PATH, "w") as f:
        json.dump(perms, f, indent=2)
        f.write("\n")


# ── Project permissions ────────────────────────────────────────────────────────

async def get_project_permissions(request: Request, project_id: int):
    project = await Project.find(project_id)
    if not project:
        return JSONResponse({"error": "Project not found"}, status_code=404)

    settings = _read_project_settings(project.path)
    perms = settings.get("permissions", {})
    return JSONResponse({
        "allow": perms.get("allow", []),
        "deny":  perms.get("deny", []),
    })


async def update_project_permissions(request: Request, project_id: int):
    project = await Project.find(project_id)
    if not project:
        return JSONResponse({"error": "Project not found"}, status_code=404)

    body = await request.json()
    allow = [s for s in (body.get("allow") or []) if isinstance(s, str) and s.strip()]
    deny  = [s for s in (body.get("deny")  or []) if isinstance(s, str) and s.strip()]

    settings = _read_project_settings(project.path)
    settings.setdefault("permissions", {})
    settings["permissions"]["allow"] = allow
    settings["permissions"]["deny"]  = deny
    _write_project_settings(project.path, settings)

    return JSONResponse({"allow": allow, "deny": deny})


# ── Default permissions ────────────────────────────────────────────────────────

async def get_default_permissions(request: Request):
    return JSONResponse(read_default_permissions())


async def update_default_permissions(request: Request):
    body = await request.json()
    allow = [s for s in (body.get("allow") or []) if isinstance(s, str) and s.strip()]
    deny  = [s for s in (body.get("deny")  or []) if isinstance(s, str) and s.strip()]
    perms = {"allow": allow, "deny": deny}
    write_default_permissions(perms)
    return JSONResponse(perms)
