from fastapi import Request
from fastapi.responses import RedirectResponse
from fastapi_startkit.inertia.inertia import Inertia

from app.models.Project import Project
from app.models.Agent import Agent
from app.controllers.global_settings_controller import read_global_settings


async def _shared_props(**extra) -> dict:
    """Props that every page render includes."""
    return {
        "global_settings": await read_global_settings(),
        **extra,
    }


async def home(request: Request, project: str | None = None):
    props = await _shared_props(**({"project": project} if project else {}))
    return Inertia.render("Home", props)


async def project_home(request: Request, project: str):
    """Redirect /{project} → /{project}/{default-agent-slug}."""
    db_project = await Project.where("slug", project).first()
    if not db_project:
        return Inertia.render("Home", await _shared_props(project=project))

    # Find the default agent
    default_id = getattr(db_project, "default_agent_id", None)
    agent = None

    if default_id:
        agent = await Agent.find(default_id)

    if not agent:
        # Fall back to first agent for this project
        agents = await Agent.where("project_id", db_project.id).order_by("id", "asc").get()
        agent = agents[0] if agents else None

    if agent:
        return RedirectResponse(url=f"/{project}/agents/{agent.id}", status_code=302)

    # No agents yet — render the normal home page
    return Inertia.render("Home", await _shared_props(project=project))


async def agent_page(request: Request, project: str, agent_id: int):
    """Render the main UI with active project + agent context."""
    return Inertia.render("Home", await _shared_props(project=project, agent_id=agent_id))
