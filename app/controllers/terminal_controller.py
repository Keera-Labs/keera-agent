import asyncio
import os
import re
import uuid

from fastapi import Query, WebSocket
from fastapi_startkit.application import app

from app.models.Agent import Agent
from app.models.Project import Project
from app.models.TerminalOutput import TerminalOutput
from app.models.TerminalSession import TerminalSession
from app.terminal.connection_manager import ConnectionManager
from app.terminal.manager import TerminalManager
from app.terminal.websocket_terminal import WebsocketTerminal

_ANSI_ESCAPE = re.compile(rb'\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[^[]')

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

    db_session = await TerminalSession.create({
        'project_name': os.path.basename(cwd),
        'project_path': cwd,
    })

    if not agent_record.has_session:
        await Agent.where("id", agent_record.id).update({"has_session": True})

    terminal_manager.create(cwd=cwd, session_id=session_id)
    terminal = terminal_manager.get(session_id)

    ready_event = claude_ready.setdefault(session_id, asyncio.Event())
    asyncio.create_task(_signal_ready_and_relay(ready_event, agent_record.id))

    async def save_output(data: bytes) -> None:
        text = _strip_ansi(data).strip()
        if text and '(thinking)' not in text:
            await TerminalOutput.create({'session_id': db_session.id, 'data': text})

    bridge = WebsocketTerminal(websocket, terminal, on_output=save_output)
    conn_manager.set(session_id, bridge, cwd=cwd)

    try:
        await asyncio.wait_for(
            bridge.run(auto_send=agent_record.to_command(
                system_prompt_suffix=f"\n\n## Your identity\nYour agent ID is {agent_record.id}. When other agents ask you to report back, always use this ID as `from_agent_id` in relay calls."
            ).encode() + b'\n'),
            timeout=300.0,
        )
    except asyncio.TimeoutError:
        try:
            await websocket.close(code=1011, reason="Terminal timeout")
        except Exception:
            pass
    finally:
        conn_manager.remove(session_id)
        claude_ready.pop(session_id, None)
        terminal_manager.close(session_id)
        await Agent.where("id", agent_record.id).update({"session_id": None})


async def _signal_ready_and_relay(event: asyncio.Event, agent_id: int) -> None:
    await asyncio.sleep(2.0)
    event.set()
    await _deliver_pending_relay_messages(agent_id)
