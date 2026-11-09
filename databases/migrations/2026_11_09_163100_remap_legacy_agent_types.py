from fastapi_startkit.masoniteorm import Migration

from app.constant.agent_types import AgentType
from app.models.Agent import Agent
from app.models.AgentTemplate import AgentTemplate

LEGACY_AGENT_TYPES = {
    "custom": AgentType.SOFTWARE_ENGINEER,
    "qa_browser": AgentType.QA,
}


class RemapLegacyAgentTypes(Migration):
    async def up(self):
        for legacy, current in LEGACY_AGENT_TYPES.items():
            await Agent.where("agent_type", legacy).update({"agent_type": current.value})
            await AgentTemplate.where("agent_type", legacy).update({"agent_type": current.value})

    async def down(self):
        pass
