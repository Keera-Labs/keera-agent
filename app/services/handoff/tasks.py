import asyncio
import logging
from collections.abc import Coroutine

logger = logging.getLogger("keera.handoff")
_running: set[asyncio.Task] = set()


def run_in_background(coroutine: Coroutine) -> asyncio.Task:
    task = asyncio.create_task(coroutine)
    _running.add(task)
    task.add_done_callback(_finished)
    return task


def _finished(task: asyncio.Task) -> None:
    _running.discard(task)
    if not task.cancelled() and task.exception() is not None:
        logger.error("Handoff background task failed", exc_info=task.exception())
