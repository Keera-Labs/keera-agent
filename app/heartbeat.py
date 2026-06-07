import asyncio
from datetime import datetime


async def send_heartbeat(project_id: int) -> None:
    from app.models.Agent import Agent
    from app.models.Task import Task
    from app.actions.agent_message_send_action import AgentMessageSendAction

    pm = await Agent.where("project_id", project_id).where("agent_type", "pm").first()
    if not pm:
        return

    tasks = await Task.where("project_id", project_id).order_by("id", "asc").get()
    if not tasks:
        return

    lines = [f"[HEARTBEAT] Task status @ {datetime.now().strftime('%H:%M:%S')}"]
    for t in tasks:
        lines.append(f"• #{t.id} {t.status:<12} — {t.title or t.description}")
    message = "\n".join(lines)

    await AgentMessageSendAction.prepare(pm, pm, message).execute()


async def heartbeat_loop(interval_seconds: int = 60) -> None:
    from app.models.Project import Project
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            projects = await Project.all()
            for project in projects:
                try:
                    await send_heartbeat(project.id)
                except Exception:
                    pass
        except Exception:
            pass
