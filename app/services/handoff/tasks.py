import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Coroutine

logger = logging.getLogger("keera.handoff")
_running: set[asyncio.Task] = set()
HEARTBEAT_INTERVAL = 60.0


def run_in_background(coroutine: Coroutine) -> asyncio.Task:
    task = asyncio.create_task(coroutine)
    _running.add(task)
    task.add_done_callback(_finished)
    return task


def _finished(task: asyncio.Task) -> None:
    _running.discard(task)
    if not task.cancelled() and task.exception() is not None:
        logger.error("Handoff background task failed", exc_info=task.exception())


@contextlib.asynccontextmanager
async def heartbeat(
    beat: Callable[[], Awaitable[None]], interval: float = HEARTBEAT_INTERVAL
) -> AsyncIterator[None]:
    async def keep_beating() -> None:
        while True:
            await asyncio.sleep(interval)
            try:
                await beat()
            except Exception:
                logger.exception("Handoff heartbeat failed")

    task = asyncio.create_task(keep_beating())
    try:
        yield
    finally:
        task.cancel()
