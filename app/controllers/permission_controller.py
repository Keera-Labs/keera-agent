import json
import os

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Project import Project
from app.models.Agent import Agent
from app.utils.json_utils import atomic_write_json


def _parse_json_list(value) -> list:
    """Parse a JSON string column into a list, returning [] on failure."""
    if not value:
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []

_DEFAULT_PERMS_PATH = os.environ.get("KEERA_DEFAULT_PERMS_PATH") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
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
