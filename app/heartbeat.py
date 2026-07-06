import asyncio
from datetime import datetime

_task: asyncio.Task | None = None


def start(interval_seconds: int = 300) -> asyncio.Task:
    global _task
    if _task and not _task.done():
        return _task
    _task = asyncio.create_task(heartbeat_loop(interval_seconds))
    return _task


def stop() -> bool:
    global _task
    if _task and not _task.done():
        _task.cancel()
        _task = None
        return True
    return False


def is_running() -> bool:
    return _task is not None and not _task.done()


async def send_heartbeat(project_id: int) -> None:
    from app.actions.agent_message_send_action import AgentMessageSendAction
    from app.models.Agent import Agent
    from app.models.Task import Task

    pm = await Agent.where("project_id", project_id).where("agent_type", "pm").first()
    if not pm:
        return
    tasks = await Task.where("project_id", project_id).order_by("id", "asc").get()
    active = [t for t in tasks if t.status not in ("completed", "cancelled")]
    if not active:
        return
    lines = ["[HEARTBEAT] Task status @ " + datetime.now().strftime("%H:%M:%S")]
    for t in active:
        lines.append(f"* #{t.id} {t.status:<12} - {t.title or t.body}")
    await AgentMessageSendAction.prepare(pm, pm, "\n".join(lines)).execute()


async def heartbeat_loop(interval_seconds: int = 300) -> None:
    from app.models.Project import Project

    try:
        while True:
            await asyncio.sleep(interval_seconds)
            try:
                for project in await Project.all():
                    await send_heartbeat(project.id)
            except Exception:
                pass
    except asyncio.CancelledError:
        pass
