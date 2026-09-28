from fastapi.responses import JSONResponse

from app.actions.agent_status_action import CLEARED_ATTENTION, notify_agent_status, utc_now
from app.controllers.agent_controller import stop_agent_session
from app.models.Agent import Agent

ACTIVE_STATUSES = ("running", "needs_input")


async def store(project_id: int):
    """Pause every active agent of a project: kill its terminal and mark it idle.

    `has_session` is left untouched, so the next start resumes the conversation.
    """
    agents = (
        await Agent.where("project_id", project_id)
        .where_null("deleted_at")
        .where_in("status", list(ACTIVE_STATUSES))
        .get()
    )

    for agent in agents:
        await stop_agent_session(agent.session_id)
        await Agent.where("id", agent.id).update(
            {
                "status": "idle",
                "session_id": None,
                "current_activity": None,
                **CLEARED_ATTENTION,
                "updated_at": utc_now(),
            }
        )
        await notify_agent_status(agent, "idle")

    return JSONResponse({"paused": [agent.id for agent in agents]})
