import json

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
            # flags/permissions are plain TEXT columns; the model has no JSON
            # casts, so callers and the seeder store these as JSON strings.
            "flags": json.dumps({}),
            "permissions_allow": json.dumps([]),
            "permissions_deny": json.dumps([]),
            "dangerously_skip_permissions": True,
            "plan_mode": False,
            "is_builtin": False,
        }
