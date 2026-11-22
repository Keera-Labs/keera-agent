from fastapi_startkit.masoniteorm.testing import DatabaseTransaction
from pydantic import ValidationError

from app.actions.agent_create_action import AgentCreateAction
from app.controllers.global_settings_controller import write_global_setting
from app.models.GlobalSettings import GlobalSettings
from app.requests.agent_requests import AgentStoreRequest
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

URL = "/api/global-settings"

UNSET = {"easy": None, "medium": None, "hard": None}


class TestThinkingLevelSettingsController(TestCase):
    """PATCH commits on its own connection, so each test restores the key it touched."""

    async def asyncTearDown(self):
        await GlobalSettings.where("key", "complexity_thinking_levels").delete()
        await super().asyncTearDown()

    async def _save(self, levels):
        return await self.client.patch(URL, json={"complexity_thinking_levels": levels})

    async def test_defaults_to_unset_for_every_provider_and_tier(self):
        data = (await self.get(URL)).json()

        self.assertEqual(
            data["complexity_thinking_levels"],
            {"codex": UNSET, "claude": UNSET, "gemini": UNSET},
        )

    async def test_providers_expose_supported_thinking_levels(self):
        providers = {p["slug"]: p for p in (await self.get(URL)).json()["providers"]}

        self.assertEqual(
            providers["claude"]["thinking_levels"], ["low", "medium", "high", "xhigh", "max"]
        )
        self.assertEqual(
            providers["codex"]["thinking_levels"], ["minimal", "low", "medium", "high", "xhigh"]
        )

    async def test_saved_levels_persist_across_reads(self):
        saved = {
            "claude": {"easy": "low", "medium": None, "hard": "max"},
            "codex": {"easy": "minimal", "medium": "medium", "hard": "xhigh"},
        }

        response = await self._save(saved)

        self.assertEqual(response.status_code, 200)
        data = (await self.get(URL)).json()["complexity_thinking_levels"]
        self.assertEqual(data["claude"], saved["claude"])
        self.assertEqual(data["codex"], saved["codex"])
        self.assertEqual(data["gemini"], UNSET)

    async def test_rejects_level_unsupported_by_provider(self):
        response = await self._save({"claude": {"easy": "minimal", "medium": None, "hard": None}})

        self.assertEqual(response.status_code, 422)
        self.assertIn("minimal", response.json()["error"])
        self.assertEqual(
            (await self.get(URL)).json()["complexity_thinking_levels"]["claude"], UNSET
        )

    async def test_rejects_missing_tiers(self):
        response = await self._save({"claude": {"easy": "low"}})

        self.assertEqual(response.status_code, 422)

    async def test_rejects_unknown_provider(self):
        response = await self._save({"missing": UNSET})

        self.assertEqual(response.status_code, 422)


class TestSpawnThinkingLevelResolution(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()

    async def _spawn(self, **fields):
        request = AgentStoreRequest(name="Worker", **fields)
        return await AgentCreateAction(project_id=self.project.id, request=request).execute()

    async def test_unset_tier_leaves_thinking_level_empty(self):
        agent = await self._spawn(provider="claude", complexity="medium")

        self.assertIsNone(agent.thinking_level)
        self.assertNotIn("--effort", agent.to_command())

    async def test_uses_saved_tier_thinking_level(self):
        await write_global_setting(
            "complexity_thinking_levels",
            {"claude": {"easy": "low", "medium": "medium", "hard": "max"}},
        )

        agent = await self._spawn(provider="claude", complexity="hard")

        self.assertEqual(agent.thinking_level, "max")
        self.assertIn("--effort max", agent.to_command())

    async def test_explicit_thinking_level_overrides_tier(self):
        await write_global_setting(
            "complexity_thinking_levels",
            {"codex": {"easy": "low", "medium": "low", "hard": "low"}},
        )

        agent = await self._spawn(provider="codex", complexity="easy", thinking_level="xhigh")

        self.assertEqual(agent.thinking_level, "xhigh")

    def test_request_rejects_level_unsupported_by_provider(self):
        with self.assertRaises(ValidationError):
            AgentStoreRequest(
                name="Worker", provider="claude", complexity="easy", thinking_level="minimal"
            )


class TestAgentUpdateThinkingLevel(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.agent = await AgentFactory.new().create(project_id=self.project.id)

    async def test_rejects_level_unsupported_by_provider(self):
        response = await self.client.patch(
            f"/api/agents/{self.agent.id}", json={"thinking_level": "minimal"}
        )

        self.assertEqual(response.status_code, 422)
