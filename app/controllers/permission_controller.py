import json
import os
import shutil

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Project import Project


def _parse_json_list(value) -> list:
    """Parse a JSON string column into a list, returning [] on failure."""
    if not value:
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []

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

    # Prefer DB values; fall back to settings file, then defaults
    db_allow = _parse_json_list(getattr(project, "permissions_allow", None))
    db_deny  = _parse_json_list(getattr(project, "permissions_deny", None))

    if db_allow or db_deny:
        return JSONResponse({"allow": db_allow, "deny": db_deny})

    settings = _read_project_settings(project.path)
    if "permissions" in settings:
        perms = settings["permissions"]
    else:
        perms = read_default_permissions()
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

    # Persist to DB
    project.permissions_allow = json.dumps(allow)
    project.permissions_deny  = json.dumps(deny)
    await project.save()

    # Persist to .claude/settings.json
    settings = _read_project_settings(project.path)
    settings.setdefault("permissions", {})
    settings["permissions"]["allow"] = allow
    settings["permissions"]["deny"]  = deny
    _write_project_settings(project.path, settings)

    return JSONResponse({"allow": allow, "deny": deny})


# ── Default permissions ────────────────────────────────────────────────────────

async def _apply_to_all_projects(perms: dict) -> int:
    """Write permissions to every project's .claude/settings.json. Returns count updated."""
    projects = await Project.all()
    updated = 0
    for project in projects:
        if not project.path:
            continue
        settings = _read_project_settings(project.path)
        settings["defaultMode"] = "acceptEdits"
        settings.setdefault("permissions", {})
        settings["permissions"]["allow"] = perms.get("allow", [])
        settings["permissions"]["deny"] = perms.get("deny", [])
        try:
            _write_project_settings(project.path, settings)
            updated += 1
        except OSError:
            pass
    return updated


async def get_default_permissions(request: Request):
    return JSONResponse(read_default_permissions())


async def update_default_permissions(request: Request):
    body = await request.json()
    allow = [s for s in (body.get("allow") or []) if isinstance(s, str) and s.strip()]
    deny  = [s for s in (body.get("deny")  or []) if isinstance(s, str) and s.strip()]
    perms = {"allow": allow, "deny": deny}
    write_default_permissions(perms)
    updated = await _apply_to_all_projects(perms)
    return JSONResponse({**perms, "applied_to_projects": updated})
