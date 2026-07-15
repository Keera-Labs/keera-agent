import asyncio
import re

from app.models.Agent import Agent

_NO_CONV = re.compile(rb"No conversation found to continue", re.IGNORECASE)
_ANSI = re.compile(rb"\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[^[]")


def make_claude_session_monitor(
    agent_id, terminal, terminal_manager, session_id, build_cmd, ready_event=None
):
    """
    Returns an on_output callback for WebsocketTerminal that:
      - Detects 'No conversation found to continue' and resets has_session=False (Part 1)
      - Schedules a restart via _restart() when the sentinel is detected
      - Sets has_session=True once non-trivial output is seen without the error (Part 3)

    ready_event: optional asyncio.Event set once Claude is actually ready to accept
      a prompt — either after it has rendered real output, or after a restart has
      settled. Callers wait on it before injecting the initial task so the message
      is never typed into a still-starting PTY and silently dropped.
    """
    buf = bytearray()
    detected = False
    confirmed = False

    async def on_output(data: bytes) -> None:
        nonlocal detected, confirmed
        buf.extend(data)
        plain = _ANSI.sub(b"", bytes(buf))
        if not detected and _NO_CONV.search(plain):
            detected = True
            await Agent.where("id", agent_id).update({"has_session": False})
            asyncio.create_task(
                _restart(agent_id, terminal, terminal_manager, session_id, build_cmd, ready_event)
            )
        if not detected and not confirmed and len(plain.strip()) > 20:
            confirmed = True
            await Agent.where("id", agent_id).update({"has_session": True})
            if ready_event is not None:
                ready_event.set()

    return on_output


async def _restart(agent_id, terminal, terminal_manager, session_id, build_cmd, ready_event=None):
    """Wait for the current process to exit, then restart Claude without --continue."""
    for _ in range(10):
        if not terminal.is_alive():
            break
        await asyncio.sleep(0.3)
    if not terminal_manager.find(session_id):
        return
    agent = await Agent.find(agent_id)
    if agent:
        await terminal.write(build_cmd(agent).encode().rstrip(b"\r\n") + b"\r")
        await asyncio.sleep(2.0)
        await Agent.where("id", agent_id).update({"has_session": True})
        # Restart complete — the fresh Claude is ready, so release any waiter that
        # is holding the initial task for this session.
        if ready_event is not None:
            ready_event.set()
