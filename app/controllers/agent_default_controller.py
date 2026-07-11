from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Agent import Agent
from app.requests.agent_default_request import DefaultAgentStoreRequest
from app.resources.agent_resource import AgentResource


async def _set_project_default(project_id: int, agent_id: int | None) -> None:
    from app.models.Project import Project

    project = await Project.find_or_fail(project_id)
    project.default_agent_id = agent_id
    await project.save()


async def show(request: Request, project_id: int):
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


async def store(body: DefaultAgentStoreRequest, project_id: int):
    """Set the default agent for a project."""
    agent = await Agent.find_or_fail(body.agent_id)
    if agent.project_id != project_id:
        return JSONResponse({"error": "Agent not found in this project"}, status_code=404)

    await _set_project_default(project_id, body.agent_id)
    return AgentResource(agent)
