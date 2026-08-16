import datetime

from fastapi import Request
from fastapi.responses import RedirectResponse
from fastapi_startkit.inertia.inertia import Inertia

from app.controllers.global_settings_controller import read_global_settings
from app.models.Agent import Agent
from app.models.Project import Project
from app.models.Workspace import Workspace

# Keep in sync with SIDEBAR_PER_PAGE in resources/js/queries/projectsQuery.ts and
# PROJECTS_PER_PAGE_MAX in project_controller.py — these props seed the sidebar
# before that query's own per_page-bound fetch resolves, and the API clamps
# per_page to the same value anyway.
SIDEBAR_PROJECTS_LIMIT = 10


async def _stamp_opened(slug: str) -> None:
    """Record that a user just navigated into this project.

    The ORM only auto-stamps ``updated_at`` on the ``creating`` event, not on
    targeted query-builder updates, so it's set explicitly here. Stored in
    the same UTC ``%Y-%m-%d %H:%M:%S`` format the ORM uses elsewhere so the
    sidebar's ``ORDER BY updated_at DESC`` sort compares consistently.
    """
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    await Project.where("slug", slug).update({"updated_at": now})


async def _shared_props(**extra) -> dict:
    """Props that every page render includes."""
    # Build workspaces with embedded projects (same shape as workspace_controller.index)
    workspaces_raw = await Workspace.all()
    workspaces = []
    for w in workspaces_raw:
        projects_in_ws = await Project.where("workspace_id", w.id).get()
        workspaces.append(
            {
                "id": w.id,
                "name": w.name,
                "description": w.description,
                "projects": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "slug": p.slug,
                        "path": p.path,
                        "language": p.language,
                        "workspace_id": p.workspace_id,
                    }
                    for p in projects_in_ws
                ],
            }
        )

    # Build flat projects list (same shape as project_controller.index),
    # most-recently-opened first and capped the same way, so the sidebar's
    # first paint already matches what the /api/projects refetch returns.
    all_projects = await Project.order_by_raw("updated_at DESC").limit(SIDEBAR_PROJECTS_LIMIT).get()
    projects = [
        {
            "id": p.id,
            "name": p.name,
            "slug": p.slug,
            "path": p.path,
            "language": p.language,
            "workspace_id": int(p.workspace_id) if p.workspace_id is not None else None,
            "claude_status": p.claude_status,
            "system_prompt": p.system_prompt,
        }
        for p in all_projects
    ]

    return {
        "global_settings": await read_global_settings(),
        "workspaces": workspaces,
        "projects": projects,
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
    await _stamp_opened(project)
    return Inertia.render("agents/Detail", await _shared_props(project=project, agent_id=agent_id))
