"""UI-started scheduler that pings a project's PM agent on a user-set interval.

Mirrors the in-process asyncio pattern in ``app/heartbeat.py`` but is keyed per
project so each PM can be scheduled independently. While active AND at least one
task is in_progress, the PM receives a fixed check-in ping every N minutes. When
no in_progress task remains the scheduler disables itself so the state persists
as "off" and no orphaned loop keeps running.
"""

import asyncio

_tasks: dict[int, asyncio.Task] = {}

CHECKIN_MESSAGE = (
    "[CHECK-IN] Scheduled status ping: please review the in-progress tasks, "
    "check in with the assigned agents, and follow up with anyone who has gone "
    "quiet so nothing stalls."
)


def is_running(project_id: int) -> bool:
    task = _tasks.get(project_id)
    return task is not None and not task.done()


def start(project_id: int, interval_minutes: int) -> asyncio.Task:
    """Start the loop for a project. Idempotent: re-toggling while a loop is
    already running returns the existing task instead of spawning a duplicate."""
    existing = _tasks.get(project_id)
    if existing and not existing.done():
        return existing
    task = asyncio.create_task(_loop(project_id, interval_minutes))
    _tasks[project_id] = task
    return task


def stop(project_id: int) -> bool:
    task = _tasks.get(project_id)
    if task and not task.done():
        task.cancel()
    return _tasks.pop(project_id, None) is not None


async def _has_in_progress(project_id: int) -> bool:
    from app.models.Task import Task

    count = await Task.where("project_id", project_id).where("status", "in_progress").count()
    return bool(count)


async def _send_checkin(project_id: int) -> None:
    from app.actions.agent_message_send_action import AgentMessageSendAction
    from app.models.Agent import Agent

    pm = await Agent.where("project_id", project_id).where("agent_type", "pm").first()
    if not pm:
        return
    await AgentMessageSendAction.prepare(pm, pm, CHECKIN_MESSAGE).execute()


async def _disable(project_id: int) -> None:
    from app.models.Agent import Agent

    await (
        Agent.where("project_id", project_id)
        .where("agent_type", "pm")
        .update({"checkin_enabled": False})
    )


async def _tick(project_id: int) -> bool:
    """Run one check-in cycle. Returns False when the scheduler should stop
    because no task is in_progress (also persists the disabled state)."""
    if not await _has_in_progress(project_id):
        await _disable(project_id)
        return False
    await _send_checkin(project_id)
    return True


async def _loop(project_id: int, interval_minutes: int) -> None:
    interval_seconds = max(1, interval_minutes) * 60
    try:
        while True:
            await asyncio.sleep(interval_seconds)
            try:
                if not await _tick(project_id):
                    break
            except Exception:
                pass
    except asyncio.CancelledError:
        pass
    finally:
        # Only clear our own registration so a concurrent restart isn't clobbered.
        if _tasks.get(project_id) is asyncio.current_task():
            _tasks.pop(project_id, None)
