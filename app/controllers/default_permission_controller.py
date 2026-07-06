import json

from app.models.Agent import Agent
from app.models.Project import Project
from app.requests.permission_request import PermissionRequest
from app.resources.permission_resource import PermissionResource
from app.services.permissions.permission import (
    read_default_permissions,
    write_default_permissions,
)


async def _apply_to_all_projects(perms: dict) -> int:
    """Persist updated default permissions to every project and agent in the DB."""
    allow_json = json.dumps(perms.get("allow", []))
    deny_json = json.dumps(perms.get("deny", []))
    projects = await Project.all()
    for project in projects:
        if not project.path:
            continue
        project.permissions_allow = allow_json
        project.permissions_deny = deny_json
        await project.save()
        # Propagate to all agents belonging to this project
        agents = await Agent.where("project_id", project.id).get()
        for agent in agents:
            agent.permissions_allow = allow_json
            agent.permissions_deny = deny_json
            await agent.save()
    return len(projects)


async def show():
    perms = read_default_permissions()
    return PermissionResource(perms.get("allow"), perms.get("deny"))


async def update(body: PermissionRequest):
    perms = {"allow": body.allow, "deny": body.deny}
    write_default_permissions(perms)
    updated = await _apply_to_all_projects(perms)
    return PermissionResource(perms["allow"], perms["deny"], applied_to_projects=updated)
