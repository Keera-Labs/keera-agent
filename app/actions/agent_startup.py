import json
import logging
import os

from fastapi_startkit.application import app

from app.models.Agent import Agent
from app.models.Project import Project

logger = logging.getLogger("keera.agents")


async def wait_for_agent_cli(terminal, agent_id: int) -> bool:
    """Wait until the agent's freshly launched CLI can take its first message.

    A startup dialog is never answered for the user. If one is still open when
    the readiness wait gives up, the agent is flagged as blocked (log, dashboard
    activity and a UI event) and the wait continues until someone answers it, so
    the task is delivered then instead of being dropped.
    """
    if await terminal.wait_for_cli_ready():
        return True
    agent = await Agent.find(agent_id)
    previous_activity = agent.current_activity if agent else None
    await notify_startup_blocked(agent_id, terminal.startup_prompt)
    ready = await terminal.wait_for_cli_ready(min_wait=0, until_answered=True)
    await Agent.where("id", agent_id).update({"current_activity": previous_activity})
    return ready


async def notify_startup_blocked(agent_id: int, prompt: str | None) -> None:
    activity = f"Blocked on a startup dialog ({prompt}): open the agent's terminal to answer it"
    logger.warning("Agent %s: %s", agent_id, activity)
    await Agent.where("id", agent_id).update({"current_activity": activity})

    agent = await Agent.find(agent_id)
    project = await Project.find(agent.project_id) if agent else None
    bridge = (
        app().make("connections").find_by_cwd(os.path.expanduser(project.path)) if project else None
    )
    if bridge:
        try:
            await bridge.write(
                json.dumps(
                    {"type": "agent_startup_blocked", "agent_id": agent_id, "prompt": prompt}
                )
            )
        except Exception:
            pass
