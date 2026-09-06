import json

from fastapi_startkit.masoniteorm import Migration

from app.models.Agent import Agent
from app.models.AgentTemplate import AgentTemplate
from app.models.GlobalSettings import GlobalSettings


class RepointRetiredClaudeModel(Migration):
    async def up(self):
        retired_model = "-".join(("claude", "opus", "4", "8"))
        replacement_model = "claude-opus-5"

        for model in (Agent, AgentTemplate):
            await model.where("model", retired_model).update(
                {"provider": "claude", "model": replacement_model}
            )

        setting = await GlobalSettings.where("key", "provider_models").first()
        if not setting:
            return

        try:
            configured = json.loads(setting.value)
        except (TypeError, ValueError, json.JSONDecodeError):
            return

        claude_models = configured.get("claude") if isinstance(configured, dict) else None
        if not isinstance(claude_models, list) or retired_model not in claude_models:
            return

        configured["claude"] = [
            replacement_model if model == retired_model else model for model in claude_models
        ]
        setting.value = json.dumps(configured)
        await setting.save()

    async def down(self):
        pass
