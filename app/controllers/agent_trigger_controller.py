import asyncio
import os
import re
import subprocess
import time
import uuid

from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi_startkit.application import app

from app.models.Agent import Agent
from app.models.Project import Project
from app.controllers.terminal_controller import claude_ready
from app.terminal.connection_manager import ConnectionManager
from app.terminal.manager import TerminalManager

_ANSI_ESCAPE = re.compile(rb'\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[^[]')
_NO_CONVERSATION_PATTERN = re.compile(r'No conversation found to continue', re.IGNORECASE)

# Minimum lifetime (seconds) for a Claude process to count as a successful session
_MIN_SESSION_LIFETIME = 5.0


def _strip_ansi(data: bytes) -> str:
    return _ANSI_ESCAPE.sub(b'', data).decode('utf-8', errors='replace')


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
    spawn attempt fails with "branch already checked out".  This function detects
    and removes both the worktree directory and the stale branch before Claude runs.
    """
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
        f"To send a message to another agent, use the MCP tool relay_to_agent or run:\n"
        f"  curl -s -X POST {base_url}/api/agent-relay \\\n"
        f"    -H 'Content-Type: application/json' \\\n"
        f"    -d '{{\"from_agent_id\": {agent.id}, \"to_agent_id\": TARGET_ID, \"content\": \"your message\"}}'\n"
        f"Messages you receive appear as: [Message from Agent '<name>']: <content>\n"
        f"To create and start a NEW agent use the MCP tool spawn_agent."
    )


async def _spawn_headless_agent(agent, project, cwd: str, initial_message: str) -> None:
    """Spawn a Terminal for the agent without a WebSocket — triggered from the backend.

    Implements three-part fix for premature has_session=True:
      Part 1 – Detect 'No conversation found to continue' and auto-fallback without --continue.
      Part 2 – Reset has_session=False if the process exits in < _MIN_SESSION_LIFETIME seconds.
      Part 3 – Defer has_session=True until Claude output confirms a real session started.
    """
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

    relay_instructions = _build_relay_instructions(agent, cwd, base_url, siblings)

    # --- Part 1 setup: monitor PTY output for the "No conversation found" sentinel ---
    output_buffer: list[str] = []
    no_conversation_detected = asyncio.Event()
    session_confirmed = asyncio.Event()

    loop = asyncio.get_event_loop()
    output_queue: asyncio.Queue = asyncio.Queue()

    def _on_readable():
        try:
            data = os.read(terminal.master_fd, 4096)
            if data:
                output_queue.put_nowait(data)
        except OSError:
            pass

    loop.add_reader(terminal.master_fd, _on_readable)

    async def _drain_output():
        """Drain PTY output and watch for sentinel strings."""
        while terminal.is_alive():
            try:
                data = await asyncio.wait_for(output_queue.get(), timeout=0.1)
                text = _strip_ansi(data)
                output_buffer.append(text)
                combined = "".join(output_buffer)

                if _NO_CONVERSATION_PATTERN.search(combined) and not no_conversation_detected.is_set():
                    # Part 1: reset has_session immediately so next command omits --continue
                    await _Agent.where("id", agent.id).update({"has_session": False})
                    no_conversation_detected.set()

                # Consider the session confirmed once we see non-trivial output
                # and the "no conversation" error has not appeared
                if not no_conversation_detected.is_set() and not session_confirmed.is_set():
                    if len(combined.strip()) > 20:
                        session_confirmed.set()
            except asyncio.TimeoutError:
                continue
        # Drain remaining data after process exits
        while not output_queue.empty():
            try:
                data = output_queue.get_nowait()
                text = _strip_ansi(data)
                output_buffer.append(text)
                combined = "".join(output_buffer)
                if _NO_CONVERSATION_PATTERN.search(combined) and not no_conversation_detected.is_set():
                    await _Agent.where("id", agent.id).update({"has_session": False})
                    no_conversation_detected.set()
            except asyncio.QueueEmpty:
                break

    drain_task = asyncio.create_task(_drain_output())

    # Re-fetch agent so to_command() uses the current has_session value from DB
    fresh_agent = await _Agent.find(agent.id)

    # Write the initial Claude command to the PTY (Part 3: do NOT set has_session yet)
    await terminal.write_input(fresh_agent.to_command(relay_instructions).encode())

    start_time = time.monotonic()

    # Part 3: Set has_session=True only after we confirm the session is real
    async def _confirm_session():
        try:
            done, _ = await asyncio.wait(
                [
                    asyncio.ensure_future(session_confirmed.wait()),
                    asyncio.ensure_future(no_conversation_detected.wait()),
                ],
                timeout=10.0,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if no_conversation_detected.is_set():
                # Already reset in _drain_output; do nothing here
                return
            if session_confirmed.is_set() and not fresh_agent.has_session:
                await _Agent.where("id", agent.id).update({"has_session": True})
        except Exception:
            pass

    confirm_task = asyncio.create_task(_confirm_session())

    # Signal ready and inject the initial message
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

    # Part 1: Auto-fallback — if "No conversation found" is detected, restart without --continue
    async def _handle_no_conversation():
        try:
            await asyncio.wait_for(no_conversation_detected.wait(), timeout=20.0)
        except asyncio.TimeoutError:
            return

        # Wait for the dying process to exit (it exits immediately after printing the error)
        for _ in range(20):
            if not terminal.is_alive():
                break
            await asyncio.sleep(0.5)

        # Only restart if the session manager still knows about this terminal
        if not terminal_manager.find(session_id):
            return

        # Re-fetch so to_command() reads has_session=False that we just stored
        restarted_agent = await _Agent.find(agent.id)
        if restarted_agent:
            fresh_command = restarted_agent.to_command(relay_instructions)
            await terminal.write_input(fresh_command.encode())
            await asyncio.sleep(1.5)
            await terminal_manager.write_input(session_id, initial_message)
            # Mark session confirmed after successful fallback restart
            await _Agent.where("id", agent.id).update({"has_session": True})

    no_conv_task = asyncio.create_task(_handle_no_conversation())

    # Wait for the process to exit
    while terminal.is_alive():
        await asyncio.sleep(1.0)

    elapsed = time.monotonic() - start_time

    # Cancel background tasks
    drain_task.cancel()
    no_conv_task.cancel()
    confirm_task.cancel()

    try:
        loop.remove_reader(terminal.master_fd)
    except Exception:
        pass

    terminal_manager.close(session_id)
    claude_ready.pop(session_id, None)

    # Part 2: Reset has_session if process exited too quickly — it never established a real session
    if elapsed < _MIN_SESSION_LIFETIME:
        await _Agent.where("id", agent.id).update({"has_session": False, "session_id": None})
    else:
        await _Agent.where("id", agent.id).update({"session_id": None})
