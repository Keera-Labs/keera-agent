from fastapi_startkit.jsonapi import JsonResource

from app.services.claude_usage import ProjectUsage


class ProjectUsageResource(JsonResource[ProjectUsage]):
    """A project's Claude token usage: today's total and each agent's lifetime total."""

    def to_attributes(self) -> dict:
        usage = self.model
        return {
            "today": usage.today.to_dict(),
            "agents": {str(agent_id): agent.to_dict() for agent_id, agent in usage.agents.items()},
        }
