import json

from fastapi.responses import JSONResponse

from app.models.Project import Project
from app.models.Agent import Agent
from app.requests.permission_request import PermissionRequest
from app.resources.permission_resource import PermissionResource, _as_list
from app.services.permissions.permission import (
    read_default_permissions,
    write_default_permissions,
)


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


async def get_default_permissions():
    perms = read_default_permissions()
    return PermissionResource(perms.get("allow"), perms.get("deny"))


async def update_default_permissions(body: PermissionRequest):
    perms = {"allow": body.allow, "deny": body.deny}
    write_default_permissions(perms)
    updated = await _apply_to_all_projects(perms)
    return PermissionResource(perms["allow"], perms["deny"], applied_to_projects=updated)


# ── Agent permissions ──────────────────────────────────────────────────────────

async def get_agent_permissions(agent_id: int):
    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)
    allow = _as_list(getattr(agent, "permissions_allow", None))
    deny  = _as_list(getattr(agent, "permissions_deny", None))
    if not allow and not deny:
        perms = read_default_permissions()
        allow = perms.get("allow", [])
        deny  = perms.get("deny", [])
    return PermissionResource(allow, deny)


async def update_agent_permissions(body: PermissionRequest, agent_id: int):
    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)
    agent.permissions_allow = json.dumps(body.allow)
    agent.permissions_deny  = json.dumps(body.deny)
    await agent.save()
    return PermissionResource(body.allow, body.deny)
