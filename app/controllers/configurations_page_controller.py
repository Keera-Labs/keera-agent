from fastapi import Request
from fastapi_startkit.inertia.inertia import Inertia

from app.controllers.command_controller import commands_for_project
from app.models.Project import Project


async def index(request: Request, project: str):
    """Render the project's Configurations screen (Commands panel) as an Inertia
    page. Commands are delivered as server props so the panel needs no initial
    client fetch; live status thereafter is driven by the command WebSocket."""
    proj = await Project.where("slug", project).first()
    commands = await commands_for_project(proj.id) if proj else []
    return Inertia.render(
        "Configurations",
        {
            "project": project,
            "project_id": proj.id if proj else None,
            "commands": commands,
        },
    )
