import json

from fastapi_startkit.masoniteorm import Factory

from app.models.Agent import Agent


class AgentFactory(Factory):
    model = Agent

    def definition(self) -> dict:
        # has_session / use_worktree are intentionally omitted so the table
        # defaults apply (has_session=False, use_worktree=True), mirroring a
        # plainly-created agent.
        return {
            "name": self.fake.unique.name(),
            "agent_type": "software_engineer",
            "model": "claude-sonnet-4-6",
            "system_prompt": None,
            "status": "idle",
            # permissions are plain TEXT columns with no JSON casts on the model.
            "permissions_allow": json.dumps([]),
            "permissions_deny": json.dumps([]),
        }
