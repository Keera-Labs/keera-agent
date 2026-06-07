import asyncio
import os
import subprocess
import uuid

from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi_startkit.application import app

from app.models.Agent import Agent
from app.models.Project import Project
from app.controllers.terminal_controller import claude_ready
from app.terminal.connection_manager import ConnectionManager
from app.terminal.manager import TerminalManager


async def _inject_when_ready(session_id: str, message: str, timeout: float = 30.0) -> None:
    """Wait for Claude to signal ready, then inject the message. Falls back after timeout."""
    event = claude_ready.get(session_id)
    if event:
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            pass
    terminal_manager: TerminalManager = app().make('terminal')
    await terminal_manager.write_input(session_id, message)


async def trigger(request: Request, agent_id: int):
    """
    Trigger an agent with an initial message.
    If the agent's PTY is already running (WebSocket terminal open), waits for Claude
    to be ready then injects the message. Otherwise spawns a headless PTY, starts
    Claude interactively, and injects the message once it's ready.
    """
    body = await request.json()
    message = (body.get("message") or "").strip()
    if not message:
        return JSONResponse({"error": "message is required"}, status_code=400)

    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)

    project = await Project.find(agent.project_id)
    if not project:
        return JSONResponse({"error": "Project not found"}, status_code=404)

    # If an interactive Claude session is already running, wait for it to be ready then inject
    session_id = agent.session_id
    terminal_manager: TerminalManager = app().make('terminal')
    if session_id and terminal_manager.find(session_id):
        asyncio.create_task(_inject_when_ready(session_id, message))
        return JSONResponse({"status": "injected", "message": "Message queued for running agent"})

    # No PTY running — spawn a headless terminal and run claude interactively
    cwd = os.path.expanduser(project.path)
    asyncio.create_task(_spawn_headless_agent(agent, project, cwd, message))
    return JSONResponse({"status": "starting", "message": "Agent is starting up..."})


def _cleanup_stale_worktree(agent, cwd: str) -> None:
    """Remove a stale git worktree (and its branch) left over from a prior agent session.

    Claude creates worktrees under .claude/worktrees/<name> with a matching branch
    worktree-<name>.  If a previous session exited without cleaning up, the next
    spawn attempt fails with "branch already checked out".  This function first runs
    `git worktree prune` to sweep ALL orphaned registrations (entries whose directories
    no longer exist on disk), then detects and removes the specific worktree directory
    and stale branch for this agent before Claude runs.
    """
    # Sweep ALL stale registrations first — covers any agent whose directory was deleted
    # without a proper `git worktree remove`.  This is the fix for the 50+ prunable
    # entries that accumulated when prior sessions exited without cleanup (task #52).
    subprocess.run(
        ["git", "worktree", "prune"],
        capture_output=True, cwd=cwd,
    )

    worktree_name = f'agent-{agent.id}'
    worktree_path = os.path.join(cwd, '.claude', 'worktrees', worktree_name)
    branch_name = f'worktree-{worktree_name}'

    # Check if the worktree path is registered with git
    wt_list = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        capture_output=True, text=True, cwd=cwd,
    )
    if worktree_path in wt_list.stdout:
        subprocess.run(
            ["git", "worktree", "remove", "--force", worktree_path],
            capture_output=True, cwd=cwd,
        )

    # Delete the stale branch so Claude can recreate it fresh
    branch_list = subprocess.run(
        ["git", "branch", "--list", branch_name],
        capture_output=True, text=True, cwd=cwd,
    )
    if branch_list.stdout.strip():
        subprocess.run(
            ["git", "branch", "-D", branch_name],
            capture_output=True, cwd=cwd,
        )


async def _spawn_headless_agent(agent, project, cwd: str, initial_message: str) -> None:
    """Spawn a Terminal for the agent without a WebSocket — triggered from the backend."""
    from app.models.Agent import Agent as _Agent
    from app.utils.hook_setup import BASE_URL as base_url

    # Remove any stale worktree/branch from a prior session to avoid git conflicts
    _cleanup_stale_worktree(agent, cwd)

    session_id = str(uuid.uuid4())
    await _Agent.where("id", agent.id).update({"session_id": session_id})

    terminal_manager: TerminalManager = app().make('terminal')
    terminal_manager.create(cwd=cwd, session_id=session_id)
    terminal = terminal_manager.get(session_id)

    # Give shell time to start, then launch claude
    await asyncio.sleep(0.5)

    siblings = await _Agent.where("project_id", agent.project_id)\
        .where("id", "!=", agent.id).get()
    if siblings:
        agent_roster = "\n".join(f"  - {a.name} (ID: {a.id})" for a in siblings)
        roster_section = f"\nAgents you can message:\n{agent_roster}\n"
    else:
        roster_section = "\nNo other agents are currently registered in this project.\n"

    relay_instructions = (
        f"\n\n---\n"
        f"AGENT COMMUNICATION PROTOCOL\n"
        f"Your agent ID is: {agent.id}\n"
        f"Project ID: {agent.project_id}\n"
        f"Project directory: {cwd}\n"
        f"{roster_section}"
        f"To send a message to another agent, use the MCP tool relay_to_agent or run:\n"
        f"  curl -s -X POST {base_url}/api/agent-relay \\\n"
        f"    -H 'Content-Type: application/json' \\\n"
        f"    -d '{{\"from_agent_id\": {agent.id}, \"to_agent_id\": TARGET_ID, \"content\": \"your message\"}}'\n"
        f"Messages you receive appear as: [Message from Agent '<name>']: <content>\n"
        f"To create and start a NEW agent use the MCP tool spawn_agent."
    )

    await terminal.write_input(agent.to_command(relay_instructions).encode())
    if not agent.has_session:
        await _Agent.where("id", agent.id).update({"has_session": True})

    # Wait for Claude's startup banner, signal ready, then inject the initial message
    ready_event = claude_ready.setdefault(session_id, asyncio.Event())
    await asyncio.sleep(1.5)
    ready_event.set()
    await terminal_manager.write_input(session_id, initial_message)

    # Notify the frontend if it's already connected
    conn_manager: ConnectionManager = app().make('connections')
    bridge = conn_manager.find_by_cwd(cwd)
    if bridge:
        import json as _json
        try:
            await bridge.send_text(_json.dumps({
                "type": "agent_triggered",
                "agent_id": agent.id,
                "message": initial_message,
            }))
        except Exception:
            pass

    # Clean up once the process exits
    while terminal.is_alive():
        await asyncio.sleep(1.0)
    terminal_manager.close(session_id)
    claude_ready.pop(session_id, None)
    await _Agent.where("id", agent.id).update({"session_id": None})
