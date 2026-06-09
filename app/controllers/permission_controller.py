import json
import os
import tempfile

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Project import Project
from app.models.Agent import Agent


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


def _atomic_write_json(path: str, data: dict) -> None:
    """Write *data* to *path* atomically using a temp file + os.replace."""
    dir_name = os.path.dirname(path)
    tmp_fd, tmp_path = tempfile.mkstemp(dir=dir_name)
    try:
        with os.fdopen(tmp_fd, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        os.replace(tmp_path, path)  # atomic on POSIX
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


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
    _atomic_write_json(settings_path, settings)


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
    _atomic_write_json(_DEFAULT_PERMS_PATH, perms)


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

    project.permissions_allow = json.dumps(allow)
    project.permissions_deny  = json.dumps(deny)
    await project.save()

    return JSONResponse({"allow": allow, "deny": deny})


# ── Default permissions ────────────────────────────────────────────────────────

async def _apply_to_all_projects(perms: dict) -> int:
    """Persist updated default permissions to every project and agent in the DB."""
    allow_json = json.dumps(perms.get("allow", []))
    deny_json  = json.dumps(perms.get("deny", []))
    projects = await Project.all()
    for project in projects:
        if not project.path:
            continue
        project.permissions_allow = allow_json
        project.permissions_deny  = deny_json
        await project.save()
        # Propagate to all agents belonging to this project
        agents = await Agent.where("project_id", project.id).get()
        for agent in agents:
            agent.permissions_allow = allow_json
            agent.permissions_deny  = deny_json
            await agent.save()
    return len(projects)


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


# ── Agent permissions ──────────────────────────────────────────────────────────

async def get_agent_permissions(request: Request, agent_id: int):
    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)
    allow = _parse_json_list(getattr(agent, "permissions_allow", None))
    deny  = _parse_json_list(getattr(agent, "permissions_deny", None))
    if not allow and not deny:
        perms = read_default_permissions()
        allow = perms.get("allow", [])
        deny  = perms.get("deny", [])
    return JSONResponse({"allow": allow, "deny": deny})


async def update_agent_permissions(request: Request, agent_id: int):
    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)
    body = await request.json()
    allow = [s for s in (body.get("allow") or []) if isinstance(s, str) and s.strip()]
    deny  = [s for s in (body.get("deny")  or []) if isinstance(s, str) and s.strip()]
    agent.permissions_allow = json.dumps(allow)
    agent.permissions_deny  = json.dumps(deny)
    await agent.save()
    return JSONResponse({"allow": allow, "deny": deny})
