import asyncio
import datetime
import json as _json
import os

from fastapi import Request
from fastapi.responses import JSONResponse

from app.controllers.agent_default_controller import _set_project_default
from app.models.Agent import Agent
from app.requests.agent_requests import AgentStoreRequest, AgentUpdateRequest
from app.resources.agent_resource import AgentResource


def _default_permissions() -> tuple[str, str]:
    """Return (permissions_allow_json, permissions_deny_json) from storage/default_permissions.json."""
    from app.services.permissions.permission import read_default_permissions

    perms = read_default_permissions()
    return _json.dumps(perms.get("allow", [])), _json.dumps(perms.get("deny", []))


async def index(request: Request, project_id: int):
    agents = await Agent.where("project_id", project_id).where_null("deleted_at").get()

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
    agent = await Agent.find_or_fail(agent_id)

    update_data = body.model_dump(exclude_unset=True)

    provider = update_data.get("provider", getattr(agent, "provider", None) or "claude")
    model = update_data.get("model", agent.model)
    from app.controllers.global_settings_controller import provider_model_is_configured

    if not await provider_model_is_configured(provider, model):
        return JSONResponse(
            {"error": f"Model '{model}' is not configured for {provider}"}, status_code=422
        )

    # plan_mode is column-authoritative. If a legacy client nests it in flags,
    # promote it to the column and strip it so the two never diverge.
    if isinstance(update_data.get("flags"), dict) and "plan_mode" in update_data["flags"]:
        nested = update_data["flags"].pop("plan_mode")
        update_data.setdefault("plan_mode", bool(nested))

    # Masonite ORM cannot serialize a Python dict in UPDATE queries — it generates
    # malformed SQL (e.g. `."flags"` instead of `"agents"."flags"`).  The `flags`
    # column is a TEXT column that stores JSON, so we must serialise it ourselves.
    if "flags" in update_data and isinstance(update_data["flags"], dict):
        update_data["flags"] = _json.dumps(update_data["flags"])

    await Agent.where("id", agent_id).update(update_data)

    agent = await Agent.find_or_fail(agent_id)
    return AgentResource(agent)


async def destroy(request: Request, agent_id: int):
    from app.controllers.agent_trigger_controller import _cleanup_stale_worktree
    from app.models.Project import Project

    agent = await Agent.find_or_fail(agent_id)

    # Soft-delete before tearing the session down: every spawn path skips deleted
    # agents, so a reconnecting terminal or an incoming relay message can't resume
    # the agent (with --continue) in the window between teardown and the stamp.
    agent.deleted_at = datetime.datetime.utcnow()
    await agent.save()

    # Re-read: a spawn already in flight may have registered a newer session.
    current = await Agent.find(agent_id)
    await stop_agent_session(current.session_id if current else agent.session_id)
    await Agent.where("id", agent_id).update({"session_id": None})

    project_id = agent.project_id
    # If this was the default, pick the next available (non-deleted) agent
    project = await Project.find(project_id)
    if project and getattr(project, "default_agent_id", None) == agent_id:
        remaining = (
            await Agent.where("project_id", project_id)
            .where_null("deleted_at")
            .order_by("id", "asc")
            .get()
        )
        new_default = remaining[0].id if remaining else None
        await _set_project_default(project_id, new_default)

    # Remove the agent's git worktree and branch so it doesn't accumulate
    if project:
        cwd = os.path.expanduser(project.path)
        try:
            await asyncio.to_thread(_cleanup_stale_worktree, agent, cwd)
        except Exception:
            pass

    return JSONResponse({"ok": True})


async def stop_agent_session(session_id: str | None) -> None:
    """Disconnect an agent's terminal clients and kill every process its PTY started."""
    if not session_id:
        return

    from fastapi_startkit.application import app

    from app.terminal.readiness import claude_ready

    conn_manager = app().make("connections")
    bridge = conn_manager.get(session_id)
    conn_manager.remove(session_id)
    if bridge and bridge.websocket is not None:
        try:
            await bridge.websocket.close()
        except Exception:
            pass

    claude_ready.pop(session_id, None)
    # Terminal.aclose kills the PTY's process groups off the event loop.
    await app().make("terminal").close(session_id)


async def output(request: Request, agent_id: int):
    """Return the recent terminal output lines for a given agent."""
    from app.models.Project import Project
    from app.models.TerminalOutput import TerminalOutput
    from app.models.TerminalSession import TerminalSession

    agent = await Agent.find_or_fail(agent_id)

    project = await Project.find(agent.project_id)
    if not project:
        return JSONResponse({"lines": [], "status": "idle"})

    agent_path = os.path.join(
        os.path.expanduser(project.path), ".keera-agents", f"agent_{agent_id}"
    )

    sessions = (
        await TerminalSession.where("project_path", agent_path)
        .order_by("id", "desc")
        .limit(1)
        .get()
    )
    if not sessions:
        return JSONResponse({"lines": [], "status": getattr(agent, "status", "idle")})

    session = sessions[0]
    rows = (
        await TerminalOutput.where("session_id", session.id).order_by("id", "desc").limit(200).get()
    )
    lines = [{"id": r.id, "data": r.data, "created_at": str(r.created_at)} for r in reversed(rows)]

    return JSONResponse(
        {
            "lines": lines,
            "status": getattr(agent, "status", "idle"),
            "session_id": session.id,
        }
    )
