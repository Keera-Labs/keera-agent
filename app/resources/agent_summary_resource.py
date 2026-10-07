from fastapi_startkit.jsonapi import JsonResource

from app.models.Agent import Agent


class AgentSummaryResource(JsonResource[Agent]):
    """The slice of an agent the sidebar needs, plus its latest message and activity time."""

    def __init__(
        self, model: Agent, last_message: str | None = None, last_activity_at: str | None = None
    ):
        super().__init__(model)
        self.last_message = last_message
        self.last_activity_at = last_activity_at

    def to_attributes(self) -> dict:
        agent = self.model
        return {
            "project_id": agent.project_id,
            "name": agent.name,
            "provider": agent.provider or "claude",
            "agent_type": agent.agent_type,
            "status": agent.status,
            "attention_kind": agent.attention_kind,
            "attention_prompt": agent.attention_prompt,
            "last_message": self.last_message,
            "last_activity_at": self.last_activity_at,
        }
