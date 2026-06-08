import asyncio
import os
import re
import uuid

from fastapi import Query, WebSocket
from fastapi_startkit.application import app

from app.models.Agent import Agent
from app.models.Project import Project
from app.terminal.connection_manager import ConnectionManager
from app.terminal.manager import TerminalManager
from app.terminal.websocket_terminal import WebsocketTerminal

_ANSI_ESCAPE = re.compile(rb'\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[^[]')
_NO_CONVERSATION_PATTERN = re.compile(r'No conversation found to continue', re.IGNORECASE)

# Registry: session_id (UUID) -> Event set when Claude has finished starting up
claude_ready: dict[str, asyncio.Event] = {}


def _strip_ansi(data: bytes) -> str:
    return _ANSI_ESCAPE.sub(b'', data).decode('utf-8', errors='replace')


async def _deliver_pending_relay_messages(agent_id: int) -> None:
    """Inject any queued agent-to-agent relay messages into the running PTY."""
    from app.models.AgentRelayMessage import AgentRelayMessage

    pending = await AgentRelayMessage.where("to_agent_id", agent_id) \
        .where("status", "pending").order_by("id", "asc").get()
    if not pending:
        return

    await asyncio.sleep(2.0)  # Let Claude finish starting up

    agent = await Agent.find(agent_id)
    session_id = agent.session_id if agent else None
    conn_manager: ConnectionManager = app().make('connections')
    bridge = conn_manager.get(session_id) if session_id else None

    for msg in pending:
        from_agent = await Agent.find(msg.from_agent_id)
        sender_name = from_agent.name if from_agent else f"Agent #{msg.from_agent_id}"
        if bridge:
            await bridge.write(f"[Message from Agent '{sender_name}']: {msg.content}")
        await AgentRelayMessage.where("id", msg.id).update({"status": "delivered"})


def _make_ws_output_monitor(agent_id: int, terminal, terminal_manager: TerminalManager,
                             session_id: str, claude_cmd: str):
    """
    Returns an on_output callback for WebsocketTerminal that:
      - Detects 'No conversation found to continue' (Part 1)
      - Resets has_session=False in DB immediately on detection
      - Restarts Claude without --continue and re-signals ready
      - Sets has_session=True only after non-trivial output is seen (Part 3)
    """
    output_buffer: list[str] = []
    no_conversation_detected = False
    has_session_confirmed = False

    async def on_output(data: bytes) -> None:
        nonlocal no_conversation_detected, has_session_confirmed

        text = _strip_ansi(data)
        output_buffer.append(text)
        combined = "".join(output_buffer)

        # Part 1: detect sentinel and schedule fallback (only once)
        if _NO_CONVERSATION_PATTERN.search(combined) and not no_conversation_detected:
            no_conversation_detected = True
            asyncio.create_task(_ws_fallback_no_continue(agent_id, terminal, terminal_manager,
                                                         session_id, claude_cmd))

        # Part 3: confirm session once we see non-trivial output with no error
        if not no_conversation_detected and not has_session_confirmed:
            if len(combined.strip()) > 20:
                has_session_confirmed = True
                await Agent.where("id", agent_id).update({"has_session": True})

    return on_output


async def _ws_fallback_no_continue(agent_id: int, terminal, terminal_manager: TerminalManager,
                                    session_id: str, claude_cmd_with_continue: str) -> None:
    """
    Called when 'No conversation found to continue' is detected on the WS terminal.
    Resets has_session, waits for the process to settle, then re-issues the command
    without --continue so Claude starts a fresh session.
    """
    # Reset has_session so next to_command() call omits --continue
    await Agent.where("id", agent_id).update({"has_session": False})

    # Give the process a moment to exit / settle
    for _ in range(10):
        if not terminal.is_alive():
            break
        await asyncio.sleep(0.3)

    # Only restart if the terminal is still registered (not closed by disconnect)
    if not terminal_manager.find(session_id):
        return

    # Re-fetch agent so to_command() picks up has_session=False
    fresh_agent = await Agent.find(agent_id)
    if fresh_agent:
        system_prompt_suffix = (
            f"\n\n## Your identity\nYour agent ID is {fresh_agent.id}. "
            f"When other agents ask you to report back, always use this ID as `from_agent_id` in relay calls."
        )
        fresh_cmd = fresh_agent.to_command(system_prompt_suffix=system_prompt_suffix)
        await terminal.write_input(fresh_cmd.encode())
        # Let the new session establish before marking it
        await asyncio.sleep(2.0)
        await Agent.where("id", agent_id).update({"has_session": True})


async def terminal_ws(websocket: WebSocket, project: str, agent_id: int = Query()):
    await websocket.accept()

    project_record = await Project.where("slug", project).first()
    if not project_record:
        await websocket.close(code=1008, reason="Project not found")
        return

    agent_record = await Agent.where("id", agent_id).where_null("deleted_at").first()
    if not agent_record:
        await websocket.close(code=1008, reason="Agent not found")
        return

    cwd = os.path.expanduser(project_record.path)
    os.makedirs(cwd, exist_ok=True)

    terminal_manager: TerminalManager = app().make('terminal')
    conn_manager: ConnectionManager = app().make('connections')

    # If this agent already has an active session, reattach without stopping it on disconnect.
    existing_key = agent_record.session_id
    existing_terminal = terminal_manager.find(existing_key) if existing_key else None
    if existing_terminal and existing_terminal.is_alive():
        reattach_bridge = WebsocketTerminal(websocket, existing_terminal)
        conn_manager.set(existing_key, reattach_bridge, cwd=cwd)
        try:
            await reattach_bridge.run(stop_on_disconnect=False)
        finally:
            conn_manager.remove(existing_key)
        return

    session_id = str(uuid.uuid4())
    await Agent.where("id", agent_record.id).update({"session_id": session_id})

    # Part 3 (WS path): do NOT set has_session=True yet — wait for confirmed output.
    # The on_output callback from _make_ws_output_monitor will set it once Claude starts.

    terminal_manager.create(cwd=cwd, session_id=session_id)
    terminal = terminal_manager.get(session_id)

    ready_event = claude_ready.setdefault(session_id, asyncio.Event())
    asyncio.create_task(_signal_ready_and_relay(ready_event, agent_record.id))

    system_prompt_suffix = (
        f"\n\n## Your identity\nYour agent ID is {agent_record.id}. "
        f"When other agents ask you to report back, always use this ID as `from_agent_id` in relay calls."
    )
    claude_cmd = agent_record.to_command(system_prompt_suffix=system_prompt_suffix)

    # Build the output monitor callback (Parts 1 & 3 for WS path)
    on_output = _make_ws_output_monitor(
        agent_id=agent_record.id,
        terminal=terminal,
        terminal_manager=terminal_manager,
        session_id=session_id,
        claude_cmd=claude_cmd,
    )

    bridge = WebsocketTerminal(websocket, terminal, on_output=on_output)
    conn_manager.set(session_id, bridge, cwd=cwd)

    try:
        await bridge.run(auto_send=claude_cmd.encode() + b'\n')
    finally:
        conn_manager.remove(session_id)
        claude_ready.pop(session_id, None)
        terminal_manager.close(session_id)
        await Agent.where("id", agent_record.id).update({"session_id": None})


async def _signal_ready_and_relay(event: asyncio.Event, agent_id: int) -> None:
    await asyncio.sleep(2.0)
    event.set()
    await _deliver_pending_relay_messages(agent_id)
