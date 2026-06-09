import asyncio
import datetime
import json as _json
import os

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.models.Agent import Agent
from app.requests.agent_requests import AgentStoreRequest, AgentUpdateRequest
from app.resources.agent_resource import AgentResource


def _default_permissions() -> tuple[str, str]:
    """Return (permissions_allow_json, permissions_deny_json) from storage/default_permissions.json."""
    from app.controllers.permission_controller import read_default_permissions
    perms = read_default_permissions()
    return _json.dumps(perms.get("allow", [])), _json.dumps(perms.get("deny", []))


async def index(request: Request, project_id: int):
    from app.actions.agent_create_action import AgentCreateAction
    from app.models.Project import Project

    agents = (
        await Agent
        .where("project_id", project_id)
        .where_null("deleted_at")
        .exists()
    )

    if not agents:
        agent = await AgentCreateAction(
            project_id=project_id,
            request=AgentStoreRequest(
                name="PM",
                agent_type="pm",
                description="Project manager agent that coordinates work across the team.",
                dangerously_skip_permissions=True,
                plan_mode=True,
            ),
        ).execute()

        await Project.where("id", project_id).update({"default_agent_id": agent.id})

    agents = (
        await Agent
        .where("project_id", project_id)
        .where_null("deleted_at")
        .get()
    )

    return AgentResource.collection(agents)


async def store(request: Request, body: AgentStoreRequest, project_id: int):
    from app.actions.agent_create_action import AgentCreateAction

    try:
        agent = await AgentCreateAction(project_id=project_id, request=body).execute()
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=422)

    # If this is the first agent in the project, make it the default
    count = await Agent.where("project_id", project_id).where_null("deleted_at").count()
    if count == 1:
        await _set_project_default(project_id, agent.id)

    return AgentResource(agent)


async def update(body: AgentUpdateRequest, agent_id: int):
    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)

    update_data = body.model_dump(exclude_unset=True)

    # Masonite ORM cannot serialize a Python dict in UPDATE queries — it generates
    # malformed SQL (e.g. `."flags"` instead of `"agents"."flags"`).  The `flags`
    # column is a TEXT column that stores JSON, so we must serialise it ourselves.
    if "flags" in update_data and isinstance(update_data["flags"], dict):
        update_data["flags"] = _json.dumps(update_data["flags"])

    await Agent.where("id", agent_id).update(update_data)

    agent = await Agent.find(agent_id)
    return AgentResource(agent)


async def destroy(request: Request, agent_id: int):
    from app.models.Project import Project
    from fastapi_startkit.application import app
    from app.terminal.connection_manager import ConnectionManager
    from app.terminal.manager import TerminalManager

    agent = await Agent.find_or_fail(agent_id)

    # Clean up WebSocket, PTY, and ConnectionManager entry before deleting the DB record
    session_id = agent.session_id
    if session_id:
        try:
            conn_manager: ConnectionManager = app().make('connections')
            terminal_manager: TerminalManager = app().make('terminal')

            bridge = conn_manager.get(session_id)
            if bridge:
                try:
                    await bridge.websocket.close()
                except Exception:
                    pass

            conn_manager.remove(session_id)
            terminal_manager.close(session_id)
        except Exception:
            pass

    project_id = agent.project_id
    # Soft-delete: stamp deleted_at instead of removing the row
    agent.deleted_at = datetime.datetime.utcnow()
    await agent.save()

    # If this was the default, pick the next available (non-deleted) agent
    project = await Project.find(project_id)
    if project and getattr(project, "default_agent_id", None) == agent_id:
        remaining = await Agent.where("project_id", project_id).where_null("deleted_at").order_by("id", "asc").get()
        new_default = remaining[0].id if remaining else None
        await _set_project_default(project_id, new_default)

    return JSONResponse({"ok": True})


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


async def spawn(request: Request, project_id: int):
    """Create a new agent, notify the frontend sidebar, and optionally start it."""
    from app.actions.agent_create_action import AgentCreateAction
    from app.models.Project import Project
    from app.terminal.connection_manager import ConnectionManager

    try:
        inp = AgentStoreRequest(**(await request.json()))
    except ValidationError as e:
        return JSONResponse({"error": e.errors()}, status_code=422)

    try:
        agent = await AgentCreateAction(project_id=project_id, request=inp).execute()
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=422)
    message = (inp.message or "").strip() or None

    # Push agent_created to ALL active connections for this project
    # (project terminal + every agent terminal) so the sidebar updates regardless
    # of which WebSocket the frontend is currently listening on.
    project = await Project.find(project_id)
    if project:
        cwd = os.path.expanduser(project.path)
        payload = _json.dumps({"type": "agent_created", "agent": AgentResource(agent).serialize()})
        conn_manager: ConnectionManager = app().make('connections')
        for bridge in conn_manager.all_for_cwd(cwd):
            try:
                await bridge.send_text(payload)
            except Exception:
                pass

        # Trigger the agent headlessly if an initial message was provided
        if message:
            from app.controllers.agent_trigger_controller import _spawn_headless_agent
            conn_key = f"{cwd}:agent:{agent.id}"
            asyncio.create_task(_spawn_headless_agent(agent, project, cwd, conn_key, message))

    return AgentResource(agent)


async def output(request: Request, agent_id: int):
    """Return the recent terminal output lines for a given agent."""
    from app.models.TerminalSession import TerminalSession
    from app.models.TerminalOutput import TerminalOutput
    from app.models.Project import Project

    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)

    project = await Project.find(agent.project_id)
    if not project:
        return JSONResponse({"lines": [], "status": "idle"})

    agent_path = os.path.join(os.path.expanduser(project.path), '.keera-agents', f'agent_{agent_id}')

    sessions = await TerminalSession.where('project_path', agent_path).order_by('id', 'desc').limit(1).get()
    if not sessions:
        return JSONResponse({"lines": [], "status": getattr(agent, 'status', 'idle')})

    session = sessions[0]
    rows = await TerminalOutput.where('session_id', session.id).order_by('id', 'desc').limit(200).get()
    lines = [{"id": r.id, "data": r.data, "created_at": str(r.created_at)} for r in reversed(rows)]

    return JSONResponse({
        "lines": lines,
        "status": getattr(agent, 'status', 'idle'),
        "session_id": session.id,
    })
