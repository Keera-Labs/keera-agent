import asyncio
import datetime
import json as _json
import os
import re

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.models.Agent import Agent
from app.requests.agent_requests import AgentStoreRequest, AgentUpdateRequest
from app.resources.agent_resource import AgentResource


def _slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "agent"


async def _unique_slug(project_id: int, base: str, exclude_id: int | None = None) -> str:
    existing = await Agent.where("project_id", project_id).get()
    used = {a.slug for a in existing if a.slug and (exclude_id is None or a.id != exclude_id)}
    slug = base
    counter = 2
    while slug in used:
        slug = f"{base}-{counter}"
        counter += 1
    return slug


DEFAULT_PERMISSIONS_ALLOW = {
    "filesystem": {
        "read": True,
        "write": False,
        "execute": False,
        "allowed_paths": ["/home/user/projects", "/home/user/docs"],
        "allowed_commands": ["ls", "cat", "find"],
    },
    "network": {
        "curl": True,
        "http_methods": ["GET"],
        "allowed_domains": [
            "api.github.com",
            "raw.githubusercontent.com",
            "example.com",
        ],
        "blocked_domains": ["*"],
    },
    "git": {
        "enabled": True,
        "allowed_operations": ["clone", "pull", "fetch", "status", "log", "diff"],
    },
}


def _serialize(a: Agent) -> dict:
    return {
        "id": a.id,
        "project_id": a.project_id,
        "name": a.name,
        "slug": getattr(a, "slug", None) or Str.slugify(a.name),
        "description": a.description,
        "model": a.model,
        "system_prompt": a.system_prompt,
        "agent_type": a.agent_type,
        "status": a.status,
        "permissions_allow": _json.loads(a.permissions_allow) if getattr(a, "permissions_allow", None) else [],
        "permissions_deny": _json.loads(a.permissions_deny) if getattr(a, "permissions_deny", None) else [],
        "flags": a.flags or {},
        "dangerously_skip_permissions": bool(getattr(a, "dangerously_skip_permissions", True)),
        "plan_mode": bool(getattr(a, "plan_mode", False)),
        "created_at": str(a.created_at) if a.created_at else None,
    }


def _default_permissions() -> tuple[str, str]:
    """Return (permissions_allow_json, permissions_deny_json) from storage/default_permissions.json."""
    from app.controllers.permission_controller import read_default_permissions
    perms = read_default_permissions()
    return _json.dumps(perms.get("allow", [])), _json.dumps(perms.get("deny", []))


async def index(request: Request, project_id: int):
    from app.actions.agent_create_action import AgentCreateAction

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

    agent = await AgentCreateAction(project_id=project_id, request=body).execute()

    # If this is the first agent in the project, make it the default
    count = await Agent.where("project_id", project_id).count()
    if count == 1:
        await _set_project_default(project_id, agent.id)

    return AgentResource(agent)


async def update(body: AgentUpdateRequest, agent_id: int):
    agent = await Agent.find_or_fail(agent_id)
    await agent.update(body.model_dump(exclude_unset=True))

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

    project = await Project.find(project_id)
    if not project:
        return JSONResponse({"error": "Project not found"}, status_code=404)

    default_id = getattr(project, "default_agent_id", None)
    if not default_id:
        # Fall back to first agent
        agents = await Agent.where("project_id", project_id).order_by("id", "asc").get()
        if not agents:
            return JSONResponse({"default_agent": None})
        default_id = agents[0].id

    agent = await Agent.find(default_id)
    if not agent:
        return JSONResponse({"default_agent": None})

    return JSONResponse({"default_agent": _serialize(agent)})


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
    return JSONResponse({"ok": True, "default_agent": _serialize(agent)})


async def spawn(request: Request, project_id: int):
    """Create a new agent, notify the frontend sidebar, and optionally start it."""
    from app.actions.agent_create_action import AgentCreateAction
    from app.models.Project import Project
    from app.terminal.connection_manager import ConnectionManager

    try:
        inp = AgentStoreRequest(**(await request.json()))
    except ValidationError as e:
        return JSONResponse({"error": e.errors()}, status_code=422)

    agent = await AgentCreateAction(project_id=project_id, request=inp).execute()
    message = (inp.message or "").strip() or None

    # Push agent_created to ALL active connections for this project
    # (project terminal + every agent terminal) so the sidebar updates regardless
    # of which WebSocket the frontend is currently listening on.
    project = await Project.find(project_id)
    if project:
        cwd = os.path.expanduser(project.path)
        payload = _json.dumps({"type": "agent_created", "agent": _serialize(agent)})
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

    return JSONResponse(_serialize(agent), status_code=201)


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
