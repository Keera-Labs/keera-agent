import asyncio
import json as _json
import os

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Agent import Agent
from app.requests.agent_requests import AgentStoreRequest
from app.resources.agent_resource import AgentResource


async def spawn(request: Request, body: AgentStoreRequest, project_id: int):
    """Create a new agent, notify the frontend sidebar, and optionally start it."""
    from fastapi_startkit.application import app

    from app.actions.agent_create_action import AgentCreateAction
    from app.models.Project import Project
    from app.terminal.connection_manager import ConnectionManager

    try:
        agent = await AgentCreateAction(project_id=project_id, request=body).execute()
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=422)
    message = (body.message or "").strip() or None

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
    """Adopt an agent's worktree: remove the worktree, then check out its branch
    in the main repo — leaving the project ON that branch. No merge.

    The agent runs in a git worktree at <project.path>/.claude/worktrees/agent-{id}
    on branch worktree-agent-{id}. A branch checked out in a worktree cannot also
    be checked out in the main repo, so we drop the worktree directory first and
    then switch the main repo onto the branch. The branch is preserved (never
    deleted); adopting simply moves the main repo onto the agent's work.
    """
    import subprocess

    from app.controllers.agent_trigger_controller import discover_worktree_path
    from app.models.Project import Project

    agent = await Agent.find_or_fail(agent_id)
    project = await Project.find_or_fail(agent.project_id)

    cwd = os.path.expanduser(project.path)
    branch_name = f"worktree-agent-{agent_id}"

    worktree_path = discover_worktree_path(cwd, branch_name)
    if not worktree_path:
        return JSONResponse(
            {"error": f"No active worktree found for branch {branch_name}"},
            status_code=404,
        )

    # Pre-flight: refuse if the agent worktree has uncommitted or untracked
    # changes. Only committed work is on the branch, so removing the worktree
    # would silently discard anything not committed. Bail before touching
    # anything so no data is lost — the worktree is kept.
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

    # Pre-flight: refuse if the main repo has uncommitted changes to TRACKED
    # files. Those are what `git checkout` would refuse to overwrite, so we catch
    # them BEFORE removing the worktree — never destroy the worktree and then
    # fail the checkout. Untracked files are ignored on purpose: the agent
    # worktrees live under <project>/.claude/worktrees, which shows up as an
    # untracked entry in the main repo yet never blocks a checkout.
    main_status = subprocess.run(
        ["git", "-C", cwd, "status", "--porcelain", "--untracked-files=no"],
        capture_output=True,
        text=True,
    )
    if main_status.stdout.strip():
        return JSONResponse(
            {
                "error": (
                    "The project has uncommitted local changes that would block "
                    "checking out the agent branch. Commit or stash them, then retry."
                ),
                "detail": main_status.stdout.strip(),
            },
            status_code=409,
        )

    # Remove the worktree directory but keep the branch (no `git branch -D`).
    # No --force: the pre-flight confirmed the worktree is clean, so a plain
    # remove succeeds and git still guards against destroying changes if the
    # worktree turned dirty in the meantime.
    remove = subprocess.run(
        ["git", "worktree", "remove", worktree_path],
        capture_output=True,
        text=True,
        cwd=cwd,
    )
    if remove.returncode != 0:
        return JSONResponse(
            {
                "error": "Failed to remove worktree",
                "detail": (remove.stderr or remove.stdout).strip(),
                "branch": branch_name,
            },
            status_code=500,
        )

    # Check out the agent branch in the main repo, leaving the project on it.
    checkout = subprocess.run(
        ["git", "checkout", branch_name],
        capture_output=True,
        text=True,
        cwd=cwd,
    )
    if checkout.returncode != 0:
        return JSONResponse(
            {
                "error": (
                    "Removed the worktree but failed to check out the agent "
                    "branch. Check out it manually with "
                    f"`git checkout {branch_name}`."
                ),
                "detail": (checkout.stderr or checkout.stdout).strip(),
                "branch": branch_name,
            },
            status_code=409,
        )

    return JSONResponse(
        {
            "ok": True,
            "branch": branch_name,
            "worktree": worktree_path,
        }
    )
