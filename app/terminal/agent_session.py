import asyncio
from collections import defaultdict
from collections.abc import Awaitable, Callable

from fastapi import WebSocket
from fastapi_startkit.application import app

from app.models.Agent import Agent
from app.terminal.cli_supervisor import restart_cli
from app.terminal.readiness import claude_ready
from app.terminal.terminal import Terminal
from app.terminal.websocket_terminal import WebsocketTerminal

_spawn_locks: defaultdict[int, asyncio.Lock] = defaultdict(asyncio.Lock)
_owners: set[asyncio.Task] = set()


def spawn_lock(agent_id: int) -> asyncio.Lock:
    return _spawn_locks[agent_id]


def live_terminal(session_id: str | None) -> Terminal | None:
    terminal = app().make("terminal").find(session_id) if session_id else None
    return terminal if terminal and terminal.is_alive() else None


def own_session(
    agent_id: int,
    session_id: str,
    terminal: Terminal,
    on_output: Callable[[bytes], Awaitable[None]] | None = None,
    auto_send: bytes | None = None,
) -> asyncio.Task:
    task = asyncio.create_task(_run_owner(agent_id, session_id, terminal, on_output, auto_send))
    _owners.add(task)
    task.add_done_callback(_owners.discard)
    return task


async def _run_owner(agent_id, session_id, terminal, on_output, auto_send) -> None:
    owner = WebsocketTerminal(None, terminal, on_output=on_output)
    try:
        await owner.run(auto_send=auto_send, stop_on_disconnect=False)
    finally:
        claude_ready.pop(session_id, None)
        await app().make("terminal").close(session_id)
        await (
            Agent.where("id", agent_id).where("session_id", session_id).update({"session_id": None})
        )


async def attach_client(
    websocket: WebSocket, session_id: str, terminal: Terminal, cwd: str
) -> None:
    connections = app().make("connections")
    bridge = WebsocketTerminal(
        websocket,
        terminal,
        on_restart=lambda: restart_cli(session_id),
        replay_history=True,
    )
    connections.set(session_id, bridge, cwd=cwd)
    try:
        await bridge.run(stop_on_disconnect=False)
    finally:
        connections.remove(session_id, bridge)
