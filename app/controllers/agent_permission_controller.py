from app.models.Agent import Agent
from app.requests.permission_request import PermissionRequest
from app.resources.permission_resource import PermissionResource
from app.services.permissions.permission import read_default_permissions


async def show(agent_id: int):
    agent = await Agent.find_or_fail(agent_id)
    allow = agent.permissions_allow or []
    deny = agent.permissions_deny or []
    if not allow and not deny:
        perms = read_default_permissions()
        allow = perms.get("allow", [])
        deny = perms.get("deny", [])
    return PermissionResource(allow, deny)


async def update(body: PermissionRequest, agent_id: int):
    agent = await Agent.find_or_fail(agent_id)
    agent.permissions_allow = body.allow
    agent.permissions_deny = body.deny
    await agent.save()
    return PermissionResource(body.allow, body.deny)
