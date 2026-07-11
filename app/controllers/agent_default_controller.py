from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Agent import Agent
from app.resources.agent_resource import AgentResource


async def _set_project_default(project_id: int, agent_id: int | None) -> None:
    from app.models.Project import Project

    project = await Project.find(project_id)
    if project:
        project.default_agent_id = agent_id
        await project.save()


async def get_default(request: Request, project_id: int):
    """Return the default agent for a project."""
    from app.models.Project import Project

    project = await Project.find_or_fail(project_id)
    default_id = project.default_agent_id
    if not default_id:
        # Fall back to first agent
        agents = await Agent.where("project_id", project_id).order_by("id", "asc").get()
        if not agents:
            return JSONResponse(None)
        default_id = agents[0].id

    agent = await Agent.find_or_fail(default_id)

    return AgentResource(agent)


async def set_default(request: Request, project_id: int):
    """Set the default agent for a project."""
    body = await request.json()
    agent_id = body.get("agent_id")
    if not agent_id:
        return JSONResponse({"error": "agent_id is required"}, status_code=422)

    agent = await Agent.find(agent_id)
    if not agent or agent.project_id != project_id:
        return JSONResponse({"error": "Agent not found in this project"}, status_code=404)

    await _set_project_default(project_id, agent_id)
    return AgentResource(agent)
