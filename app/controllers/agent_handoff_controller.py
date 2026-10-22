from app.actions.agent_handoff_push_action import AgentHandoffPushAction
from app.models.Handoff import Handoff
from app.requests.handoff_request import AgentHandoffStoreRequest
from app.resources.handoff_resource import HandoffResource


async def index(agent_id: int):
    handoffs = await Handoff.where("agent_id", agent_id).order_by("id", "desc").get()
    return HandoffResource.collection(handoffs)


async def store(body: AgentHandoffStoreRequest, agent_id: int):
    handoff = await AgentHandoffPushAction(agent_id, body.server_id).execute()
    return HandoffResource(handoff)
