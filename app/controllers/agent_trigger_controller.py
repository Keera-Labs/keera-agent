import asyncio
import datetime
import json
import os
import subprocess
import time
import uuid

from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi_startkit.application import app

from app.actions.terminal_write_action import TerminalWriteAction
from app.controllers.terminal_controller import claude_ready
from app.models.Agent import Agent
from app.models.Project import Project
from app.terminal.claude_monitor import make_claude_session_monitor
from app.terminal.connection_manager import ConnectionManager
from app.terminal.manager import TerminalManager
from app.terminal.websocket_terminal import WebsocketTerminal

# Minimum lifetime (seconds) for a Claude process to count as a successful session
_MIN_SESSION_LIFETIME = 5.0

# Upper bound (seconds) to wait for Claude to signal ready before injecting the
# initial task anyway. Generous enough to cover a --continue restart; a missed
# readiness signal degrades to a delayed inject, never a permanent drop or hang.
_READY_TIMEOUT = 30.0


def _activity_summary(message: str) -> str:
    """First non-empty line of an injected message, trimmed for the dashboard."""
    for line in (message or "").splitlines():
        stripped = line.strip()
        if stripped:
            return stripped[:140]
    return "Working…"


async def _mark_agent_working(agent_id: int, message: str) -> None:
    """Record that an agent just started actively working — powers the dashboard's
    running state, current-activity text, and elapsed timer."""
    now = datetime.datetime.now().isoformat(sep=" ", timespec="seconds")
    await Agent.where("id", agent_id).update(
        {
            "status": "running",
            "started_at": now,
            "current_activity": _activity_summary(message),
        }
    )


async def _inject_when_ready(session_id: str, message: str, timeout: float = 30.0) -> None:
    """Wait for Claude to signal ready, then inject the message. Falls back after timeout."""
    event = claude_ready.get(session_id)
    if event:
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            pass
    terminal_manager: TerminalManager = app().make("terminal")
    data = message.encode() if isinstance(message, str) else message
    await terminal_manager.write(session_id, data.rstrip(b"\r\n"))
    await asyncio.sleep(0.05)
    await terminal_manager.write(session_id, b"\r")


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
    terminal_manager: TerminalManager = app().make("terminal")
    if session_id and terminal_manager.find(session_id):
        asyncio.create_task(_inject_when_ready(session_id, message))
        await _mark_agent_working(agent_id, message)
        return JSONResponse({"status": "injected", "message": "Message queued for running agent"})

    # No PTY running — spawn a headless terminal and run claude interactively
    cwd = os.path.expanduser(project.path)
    asyncio.create_task(_spawn_headless_agent(agent, project, cwd, message))
    return JSONResponse({"status": "starting", "message": "Agent is starting up..."})


def _cleanup_stale_worktree(agent, cwd: str) -> None:
    """Remove a stale git worktree (and its branch) left over from a prior agent session.

    Claude creates worktrees under .claude/worktrees/<name> with a matching branch
    worktree-<name>.  If a previous session exited without cleaning up, the next
    spawn attempt fails with "branch already checked out".  This function detects
    and removes both the worktree directory and the stale branch before Claude runs.
    """
    if not getattr(agent, "use_worktree", True):
        return

    worktree_name = f"agent-{agent.id}"
    worktree_path = os.path.join(cwd, ".claude", "worktrees", worktree_name)
    branch_name = f"worktree-{worktree_name}"

    # Check if the worktree path is registered with git
    wt_list = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        capture_output=True,
        text=True,
        cwd=cwd,
    )
    if worktree_path in wt_list.stdout:
        subprocess.run(
            ["git", "worktree", "remove", "--force", worktree_path],
            capture_output=True,
            cwd=cwd,
        )

    # Delete the stale branch so Claude can recreate it fresh
    branch_list = subprocess.run(
        ["git", "branch", "--list", branch_name],
        capture_output=True,
        text=True,
        cwd=cwd,
    )
    if branch_list.stdout.strip():
        subprocess.run(
            ["git", "branch", "-D", branch_name],
            capture_output=True,
            cwd=cwd,
        )


def discover_worktree_path(cwd: str, branch_name: str) -> str | None:
    """Return the real filesystem path of the worktree checked out on ``branch_name``.

    Parses ``git worktree list --porcelain`` (the same primitive
    _cleanup_stale_worktree relies on) instead of reconstructing the path from a
    convention, so an agent worktree registered at a non-default location is
    still found. Returns None when no worktree has that branch checked out.
    """
    result = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        capture_output=True,
        text=True,
        cwd=cwd,
    )
    if result.returncode != 0:
        return None

    current_path: str | None = None
    for line in result.stdout.splitlines():
        if line.startswith("worktree "):
            current_path = line[len("worktree ") :].strip()
        elif line.startswith("branch "):
            ref = line[len("branch ") :].strip()
            if ref == f"refs/heads/{branch_name}" or ref == branch_name:
                return current_path
    return None


async def _prune_all_orphaned_worktrees() -> None:
    """One-off startup prune: remove git worktrees for all soft-deleted agents.

    Iterates every soft-deleted Agent row, looks up its project path, and calls
    _cleanup_stale_worktree() to remove the worktree directory and branch that
    were left behind when the agent was deleted without cleanup.
    """
    from app.models.Agent import Agent as _Agent
    from app.models.Project import Project as _Project

    deleted_agents = await _Agent.where_not_null("deleted_at").get()
    for agent in deleted_agents:
        try:
            project = await _Project.find(agent.project_id)
            if not project:
                continue
            cwd = os.path.expanduser(project.path)
            if not os.path.isdir(cwd):
                continue
            _cleanup_stale_worktree(agent, cwd)
        except Exception:
            pass


def _build_relay_instructions(agent, cwd: str, base_url: str, siblings) -> str:
    """Build the relay-instructions system-prompt suffix for an agent."""
    if siblings:
        agent_roster = "\n".join(f"  - {a.name} (ID: {a.id})" for a in siblings)
        roster_section = f"\nAgents you can message:\n{agent_roster}\n"
    else:
        roster_section = "\nNo other agents are currently registered in this project.\n"

    return (
        f"\n\n---\n"
        f"AGENT COMMUNICATION PROTOCOL\n"
        f"Your agent ID is: {agent.id}\n"
        f"Project ID: {agent.project_id}\n"
        f"Project directory: {cwd}\n"
        f"{roster_section}"
        f"To send a message to another agent, use the MCP tool send_message_to_agent or run:\n"
        f"  curl -s -X POST {base_url}/mcp \\\n"
        f"    -H 'Content-Type: application/json' \\\n"
        f'    -d \'{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"send_message_to_agent","arguments":{{"sender_agent_id":{agent.id},"receiver_agent_id":TARGET_ID,"message":"your message"}}}}}}\'\n'
        f"Messages you receive appear as: [Message from Agent '<name>']: <content>\n"
        f"To create and start a NEW agent use the MCP tool spawn_agent."
    )


async def _spawn_headless_agent(agent, project, cwd: str, initial_message: str) -> None:
    """Spawn a Terminal for the agent without a WebSocket — triggered from the backend.

    Parts 1 & 3 are handled by make_claude_session_monitor via WebsocketTerminal(ws=None).
    Part 2 – Reset has_session=False if the process exits in < _MIN_SESSION_LIFETIME seconds.
    """
    base_url = app().make("config").get("fastapi.app_url")

    # Remove any stale worktree/branch from a prior session to avoid git conflicts
    _cleanup_stale_worktree(agent, cwd)

    session_id = str(uuid.uuid4())
    await Agent.where("id", agent.id).update({"session_id": session_id})
    await _mark_agent_working(agent.id, initial_message)

    terminal_manager: TerminalManager = app().make("terminal")
    terminal_manager.create(cwd=cwd, session_id=session_id)
    terminal = terminal_manager.get(session_id)

    # Give the shell time to start, then launch claude
    await asyncio.sleep(0.5)

    siblings = (
        await Agent.where("project_id", agent.project_id)
        .where("id", "!=", agent.id)
        .where_null("deleted_at")
        .get()
    )

    relay_instructions = _build_relay_instructions(agent, cwd, base_url, siblings)

    # Re-fetch agent so to_command() uses the current has_session value from DB
    fresh_agent = await Agent.find(agent.id)

    def _build_cmd_with_identity(a):
        """Build claude command with agent identity injected into system prompt."""
        suffix = (
            f"\n\n## Your identity\nYour agent ID is {a.id}. "
            f"When other agents ask you to report back, always use this ID as `sender_agent_id` in send_message_to_agent calls."
        )
        return a.to_command(system_prompt_suffix=suffix)

    # The monitor sets this once Claude is genuinely ready — after it renders real
    # output, or after a --continue restart settles. Injecting on that signal
    # instead of a blind timer is what stops the first task from being typed into a
    # still-starting PTY and silently lost.
    ready_event = claude_ready.setdefault(session_id, asyncio.Event())

    # Parts 1 & 3: monitor PTY output via WebsocketTerminal (no WS connection).
    monitor = make_claude_session_monitor(
        agent_id=agent.id,
        terminal=terminal,
        terminal_manager=terminal_manager,
        session_id=session_id,
        build_cmd=_build_cmd_with_identity,
        ready_event=ready_event,
    )
    bridge = WebsocketTerminal(None, terminal, on_output=monitor)
    asyncio.create_task(
        bridge.run(
            auto_send=_build_cmd_with_identity(fresh_agent).encode(),
            stop_on_disconnect=False,
        )
    )

    start_time = time.monotonic()

    # Hold the initial task until Claude signals ready, with a bounded fallback so a
    # missed signal degrades to a delayed inject rather than a hang. Then inject the
    # relay context (agent identity, roster, project dir, communication protocol)
    # followed by the task itself so the agent has full context before acting.
    try:
        await asyncio.wait_for(ready_event.wait(), timeout=_READY_TIMEOUT)
    except asyncio.TimeoutError:
        pass
    # Brief settle so the input prompt is fully interactive before typing.
    await asyncio.sleep(0.3)

    await TerminalWriteAction.prepare(session_id, relay_instructions).execute()
    await TerminalWriteAction.prepare(session_id, initial_message).execute()

    # Notify the frontend if it's already connected
    conn_manager: ConnectionManager = app().make("connections")
    ws_bridge = conn_manager.find_by_cwd(cwd)
    if ws_bridge:
        try:
            await ws_bridge.write(
                json.dumps(
                    {
                        "type": "agent_triggered",
                        "agent_id": agent.id,
                        "message": initial_message,
                    }
                )
            )
        except Exception:
            pass

    # Wait for the process to exit
    while terminal.is_alive():
        await asyncio.sleep(1.0)

    elapsed = time.monotonic() - start_time

    terminal_manager.close(session_id)
    claude_ready.pop(session_id, None)

    # Part 2: Reset has_session if process exited too quickly — it never established a real session
    if elapsed < _MIN_SESSION_LIFETIME:
        await Agent.where("id", agent.id).update({"has_session": False, "session_id": None})
    else:
        await Agent.where("id", agent.id).update({"session_id": None})
