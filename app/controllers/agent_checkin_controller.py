from app import checkin_scheduler
from app.models.Agent import Agent
from app.requests.agent_checkin_request import AgentCheckinRequest
from app.resources.agent_checkin_resource import AgentCheckinResource

DEFAULT_INTERVAL_MINUTES = 5


async def show(agent_id: int):
    agent = await Agent.find_or_fail(agent_id)
    return AgentCheckinResource(
        enabled=bool(agent.checkin_enabled),
        interval_minutes=int(agent.checkin_interval_minutes or DEFAULT_INTERVAL_MINUTES),
        running=checkin_scheduler.is_running(agent.project_id),
    )


async def update(body: AgentCheckinRequest, agent_id: int):
    agent = await Agent.find_or_fail(agent_id)

    # Scalar columns only — write via the query builder to sidestep the ORM's
    # dict/JSON serialization landmine on UPDATE (see agent_controller.update).
    await Agent.where("id", agent.id).update(
        {
            "checkin_enabled": body.enabled,
            "checkin_interval_minutes": body.interval_minutes,
        }
    )

    if body.enabled:
        checkin_scheduler.start(agent.project_id, body.interval_minutes)
    else:
        checkin_scheduler.stop(agent.project_id)

    return AgentCheckinResource(
        enabled=body.enabled,
        interval_minutes=body.interval_minutes,
        running=checkin_scheduler.is_running(agent.project_id),
    )
