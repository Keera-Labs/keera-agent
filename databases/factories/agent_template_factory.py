from fastapi_startkit.masoniteorm import Factory

from app.models.AgentTemplate import AgentTemplate


class AgentTemplateFactory(Factory):
    model = AgentTemplate

    def definition(self) -> dict:
        return {
            "name": self.fake.unique.slug(),
            "description": "orig desc",
            "agent_type": "software_engineer",
            "system_prompt": "orig prompt",
            "model": "claude-sonnet-4-6",
            "flags": {},
            "permissions_allow": [],
            "permissions_deny": [],
            "dangerously_skip_permissions": True,
            "plan_mode": False,
            "is_builtin": False,
        }
