from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.agent_create_action import AgentCreateAction
from app.controllers.global_settings_controller import write_global_setting
from app.models.GlobalSettings import GlobalSettings
from app.requests.agent_requests import AgentStoreRequest
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

URL = "/api/global-settings"

CLAUDE_MODELS = ["claude-sonnet-5", "claude-opus-5-5", "claude-fable-5"]
CODEX_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]


class TestComplexityModelSettingsController(TestCase):
    """PATCH commits on its own connection, so each test restores the keys it touched."""

    async def asyncTearDown(self):
        for key in ("provider_models", "complexity_models", "default_provider"):
            await GlobalSettings.where("key", key).delete()
        await super().asyncTearDown()

    async def _save(self, complexity_models: dict, default_provider: str = "claude"):
        return await self.client.patch(
            URL,
            json={
                "provider_models": {"claude": CLAUDE_MODELS, "codex": CODEX_MODELS},
                "default_provider": default_provider,
                "complexity_models": complexity_models,
            },
        )

    async def test_saved_complexity_models_persist_across_reads(self):
        saved = {
            "claude": {"easy": "claude-sonnet-5", "medium": "claude-opus-5-5", "hard": "claude-fable-5"},
            "codex": {"easy": "gpt-5.6-sol", "medium": "gpt-5.6-sol", "hard": "gpt-5.6-sol"},
        }

        response = await self._save(saved)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["complexity_models"], saved)

        data = (await self.get(URL)).json()
        self.assertEqual(data["complexity_models"], saved)
        self.assertEqual(data["default_provider"], "claude")

    async def test_defaults_are_returned_when_nothing_is_saved(self):
        data = (await self.get(URL)).json()

        self.assertEqual(data["default_provider"], "codex")
        self.assertEqual(
            data["complexity_models"]["claude"],
            {"easy": "claude-sonnet-5", "medium": "claude-opus-5", "hard": "claude-fable-5"},
        )
        self.assertEqual(
            data["complexity_models"]["codex"],
            {"easy": "gpt-5.6-luna", "medium": "gpt-5.6-terra", "hard": "gpt-5.6-sol"},
        )

    async def test_rejects_model_not_configured_for_provider(self):
        response = await self._save(
            {"claude": {"easy": "gpt-5.6-luna", "medium": "claude-opus-5-5", "hard": "claude-fable-5"}}
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("gpt-5.6-luna", response.json()["error"])
        claude_models = (await self.get(URL)).json()["provider_models"]["claude"]
        self.assertNotIn("claude-opus-5-5", claude_models)

    async def test_rejects_unknown_default_provider(self):
        response = await self.client.patch(URL, json={"default_provider": "gemini"})

        self.assertEqual(response.status_code, 422)


class TestSpawnModelResolution(TestCase, DatabaseTransaction):
    """spawn_agent builds an AgentStoreRequest with a provider and complexity but no model."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()

    async def _spawn(self, provider: str, complexity: str):
        request = AgentStoreRequest(name="Worker", provider=provider, complexity=complexity)
        return await AgentCreateAction(project_id=self.project.id, request=request).execute()

    async def test_uses_saved_complexity_model(self):
        await write_global_setting("provider_models", {"claude": CLAUDE_MODELS, "codex": CODEX_MODELS})
        await write_global_setting(
            "complexity_models",
            {"claude": {"easy": "claude-sonnet-5", "medium": "claude-opus-5-5", "hard": "claude-fable-5"}},
        )

        agent = await self._spawn("claude", "medium")

        self.assertEqual(agent.model, "claude-opus-5-5")

    async def test_falls_back_to_built_in_defaults(self):
        for complexity, model in (("easy", "gpt-5.6-luna"), ("medium", "gpt-5.6-terra"), ("hard", "gpt-5.6-sol")):
            agent = await self._spawn("codex", complexity)
            self.assertEqual(agent.model, model)

    async def test_falls_back_to_a_configured_model_when_default_was_removed(self):
        await write_global_setting(
            "provider_models",
            {"claude": ["claude-sonnet-5", "claude-fable-5"], "codex": CODEX_MODELS},
        )

        agent = await self._spawn("claude", "medium")

        self.assertEqual(agent.model, "claude-sonnet-5")
