import asyncio

# session_id -> Event set once the CLI in that session can take a message.
claude_ready: dict[str, asyncio.Event] = {}


def mark_booting(session_id: str) -> asyncio.Event:
    """Register a fresh, unset ready event for a session that is (re)starting its CLI.

    The event is replaced rather than cleared so a waiter still holding the
    previous boot's event can't flip this boot to ready when it finishes.
    """
    event = claude_ready[session_id] = asyncio.Event()
    return event


def is_cli_ready(session_id: str | None) -> bool:
    """A live session with no ready event is still being set up, so it is not ready."""
    event = claude_ready.get(session_id) if session_id else None
    return event is not None and event.is_set()
