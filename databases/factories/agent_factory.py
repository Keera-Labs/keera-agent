from fastapi_startkit.masoniteorm import Factory

from app.models.Agent import Agent


class AgentFactory(Factory):
    model = Agent

    def definition(self) -> dict:
        return {
            "name": self.fake.unique.name(),
            "agent_type": "software_engineer",
            "model": "claude-sonnet-4-6",
            "system_prompt": "You are a Senior Software Engineer.",
            "status": "idle",
            "permissions_allow": [],
            "permissions_deny": [],
        }
