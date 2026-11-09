import asyncio
import logging

from app.actions.agent_health_action import probe_live_agents

PROBE_INTERVAL_SECONDS = 60

logger = logging.getLogger(__name__)

_task: asyncio.Task | None = None


def start(interval_seconds: int = PROBE_INTERVAL_SECONDS) -> asyncio.Task:
    global _task
    if _task and not _task.done():
        return _task
    _task = asyncio.create_task(_loop(interval_seconds))
    return _task


def stop() -> None:
    global _task
    if _task and not _task.done():
        _task.cancel()
    _task = None


async def _loop(interval_seconds: int) -> None:
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await probe_live_agents()
        except Exception:
            logger.exception("Agent worktree probe failed")
