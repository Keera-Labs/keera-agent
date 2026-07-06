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
    from app.services.permissions.permission import read_default_permissions

    perms = read_default_permissions()
    return _json.dumps(perms.get("allow", [])), _json.dumps(perms.get("deny", []))


async def index(request: Request, project_id: int):
    from app.actions.agent_create_action import AgentCreateAction
    from app.models.Project import Project

    agents = await Agent.where("project_id", project_id).where_null("deleted_at").exists()

    if not agents:
        agent = await AgentCreateAction(
            project_id=project_id,
            request=AgentStoreRequest(
                name="PM",
                agent_type="pm",
                description="Project manager agent that coordinates work across the team.",
                dangerously_skip_permissions=True,
            ),
        ).execute()

        await Project.where("id", project_id).update({"default_agent_id": agent.id})

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
    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)

    update_data = body.model_dump(exclude_unset=True)

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

    agent = await Agent.find(agent_id)
    return AgentResource(agent)


async def destroy(request: Request, agent_id: int):
    from fastapi_startkit.application import app

    from app.controllers.agent_trigger_controller import _cleanup_stale_worktree
    from app.models.Project import Project
    from app.terminal.connection_manager import ConnectionManager
    from app.terminal.manager import TerminalManager

    agent = await Agent.find_or_fail(agent_id)

    # Clean up WebSocket, PTY, and ConnectionManager entry before deleting the DB record
    session_id = agent.session_id
    if session_id:
        try:
            conn_manager: ConnectionManager = app().make("connections")
            terminal_manager: TerminalManager = app().make("terminal")

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
            _cleanup_stale_worktree(agent, cwd)
        except Exception:
            pass

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
    from fastapi_startkit.application import app

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
        conn_manager: ConnectionManager = app().make("connections")
        for bridge in conn_manager.all_for_cwd(cwd):
            try:
                await bridge.write(payload)
            except Exception:
                pass

        # Trigger the agent headlessly if an initial message was provided
        if message:
            from app.controllers.agent_trigger_controller import _spawn_headless_agent

            conn_key = f"{cwd}:agent:{agent.id}"
            asyncio.create_task(_spawn_headless_agent(agent, project, cwd, conn_key, message))

    return AgentResource(agent)


async def adopt_work(agent_id: int):
    """Adopt an agent's worktree: merge its branch into the project's current
    branch, then remove the worktree while KEEPING the branch.

    The agent runs in a git worktree at <project.path>/.claude/worktrees/agent-{id}
    on branch worktree-agent-{id}. We merge that branch into whatever branch the
    main repo (project.path) currently has checked out, then drop the worktree
    directory. The branch is intentionally preserved so the merged history stays
    referenceable.
    """
    import subprocess

    from app.controllers.agent_trigger_controller import discover_worktree_path
    from app.models.Project import Project

    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)

    project = await Project.find(agent.project_id)
    if not project:
        return JSONResponse({"error": "Project not found"}, status_code=404)

    cwd = os.path.expanduser(project.path)
    branch_name = f"worktree-agent-{agent_id}"

    worktree_path = discover_worktree_path(cwd, branch_name)
    if not worktree_path:
        return JSONResponse(
            {"error": f"No active worktree found for branch {branch_name}"},
            status_code=404,
        )

    # Pre-flight: refuse if the agent worktree has uncommitted or untracked
    # changes. Only committed work is on the branch we merge, so removing the
    # worktree would silently discard anything not committed. Bail before the
    # merge so nothing is changed and no data is lost — the worktree is kept.
    wt_status = subprocess.run(
        ["git", "-C", worktree_path, "status", "--porcelain"],
        capture_output=True,
        text=True,
    )
    if wt_status.stdout.strip():
        return JSONResponse(
            {
                "error": (
                    "The agent worktree has uncommitted changes that would be "
                    "lost. Commit or discard them in the worktree, then retry."
                ),
                "detail": wt_status.stdout.strip(),
            },
            status_code=409,
        )

    # Merge the agent branch into the current branch of the main repo. A branch
    # checked out in a worktree cannot be checked out here, but merging its ref
    # is fine since merge never touches the worktree's own working copy.
    merge = subprocess.run(
        ["git", "merge", "--no-edit", branch_name],
        capture_output=True,
        text=True,
        cwd=cwd,
    )
    if merge.returncode != 0:
        detail = (merge.stderr or merge.stdout).strip()
        # A real content conflict starts a merge (MERGE_HEAD exists) that must be
        # aborted to unwind it. A refusal to even start — the main repo's working
        # tree is dirty and the merge would overwrite local changes — leaves no
        # merge in progress, so there is nothing to abort. Distinguish the two so
        # the caller gets an actionable message; both are safe (no partial state).
        merge_in_progress = (
            subprocess.run(
                ["git", "rev-parse", "-q", "--verify", "MERGE_HEAD"],
                capture_output=True,
                cwd=cwd,
            ).returncode
            == 0
        )
        if merge_in_progress:
            subprocess.run(["git", "merge", "--abort"], capture_output=True, cwd=cwd)
            error = "Merge conflict — resolve conflicts manually before adopting"
        else:
            error = (
                "Cannot merge: the project has uncommitted local changes that "
                "would be overwritten. Commit or stash them, then retry."
            )
        return JSONResponse({"error": error, "detail": detail}, status_code=409)

    # Remove the worktree directory but keep the branch (no `git branch -D`).
    # No --force: the pre-flight check confirmed the worktree is clean, so a
    # plain remove succeeds and git still guards against destroying changes if
    # the worktree turned dirty in the meantime.
    remove = subprocess.run(
        ["git", "worktree", "remove", worktree_path],
        capture_output=True,
        text=True,
        cwd=cwd,
    )
    if remove.returncode != 0:
        return JSONResponse(
            {
                "error": "Merged, but failed to remove worktree",
                "detail": (remove.stderr or remove.stdout).strip(),
                "branch": branch_name,
            },
            status_code=500,
        )

    return JSONResponse(
        {
            "ok": True,
            "branch": branch_name,
            "worktree": worktree_path,
        }
    )


async def output(request: Request, agent_id: int):
    """Return the recent terminal output lines for a given agent."""
    from app.models.Project import Project
    from app.models.TerminalOutput import TerminalOutput
    from app.models.TerminalSession import TerminalSession

    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)

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
