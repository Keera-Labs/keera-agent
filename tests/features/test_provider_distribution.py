import re

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.agent_create_action import AgentCreateAction
from app.actions.agent_status_action import utc_now
from app.controllers.global_settings_controller import write_global_setting
from app.mcp.tools import SpawnAgentTool
from app.models.Agent import Agent
from app.models.GlobalSettings import GlobalSettings
from app.requests.agent_requests import AgentStoreRequest
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

URL = "/api/global-settings"
DISTRIBUTION_KEYS = ["provider_distribution", "distribution_providers", "enforce_default_provider"]


class TestProviderDistributionSettings(TestCase):
    async def asyncTearDown(self):
        await GlobalSettings.where_in("key", DISTRIBUTION_KEYS).delete()
        await super().asyncTearDown()

    async def test_defaults_to_default_provider_mode_with_every_provider(self):
        data = (await self.get(URL)).json()

        self.assertEqual(data["provider_distribution"], "default")
        self.assertEqual(data["distribution_providers"], ["codex", "claude", "gemini"])

    async def test_persists_even_distribution_and_selected_providers(self):
        response = await self.client.patch(
            URL,
            json={"provider_distribution": "even", "distribution_providers": ["gemini", "codex"]},
        )

        self.assertEqual(response.status_code, 200)
        data = (await self.get(URL)).json()
        self.assertEqual(data["provider_distribution"], "even")
        self.assertEqual(data["distribution_providers"], ["codex", "gemini"])

    async def test_rejects_even_distribution_without_providers(self):
        response = await self.client.patch(
            URL, json={"provider_distribution": "even", "distribution_providers": []}
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("at least one provider", response.json()["error"])
        self.assertEqual((await self.get(URL)).json()["provider_distribution"], "default")

    async def test_allows_empty_providers_in_default_mode(self):
        response = await self.client.patch(
            URL, json={"provider_distribution": "default", "distribution_providers": []}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["distribution_providers"], [])

    async def test_rejects_unknown_distribution_provider(self):
        response = await self.client.patch(URL, json={"distribution_providers": ["codex", "nope"]})

        self.assertEqual(response.status_code, 422)
        self.assertIn("nope", response.json()["error"])

    async def test_rejects_unknown_distribution_mode(self):
        response = await self.client.patch(URL, json={"provider_distribution": "random"})

        self.assertEqual(response.status_code, 422)

    async def test_rejects_even_distribution_while_enforcing_default_provider(self):
        response = await self.client.patch(
            URL, json={"provider_distribution": "even", "enforce_default_provider": True}
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("enforcing the default provider", response.json()["error"])
        self.assertFalse((await self.get(URL)).json()["enforce_default_provider"])


class TestProviderDistributionSpawns(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        await write_global_setting("max_agents_per_project", 10)

    async def _distribute(self, providers: list[str]):
        await write_global_setting("provider_distribution", "even")
        await write_global_setting("distribution_providers", providers)

    async def _spawn(self, **fields):
        request = AgentStoreRequest(name="Worker", complexity="medium", **fields)
        return await AgentCreateAction(project_id=self.project.id, request=request).execute()

    async def _spawned_providers(self, count: int) -> list[str]:
        return [(await self._spawn()).provider for _ in range(count)]

    async def _spawn_via_tool(self, **arguments) -> Agent:
        response = await SpawnAgentTool().handle(
            {
                "project_path": self.project.path,
                "name": "Spawned",
                "complexity": "medium",
                **arguments,
            }
        )
        agent_id = int(re.search(r"ID:\s*(\d+)", response.to_content()[0]["text"]).group(1))
        return await Agent.find(agent_id)

    async def test_default_mode_uses_default_provider(self):
        await write_global_setting("default_provider", "claude")

        self.assertEqual(await self._spawned_providers(3), ["claude", "claude", "claude"])

    async def test_even_mode_rotates_across_two_providers(self):
        await self._distribute(["codex", "claude"])

        self.assertEqual(await self._spawned_providers(4), ["codex", "claude", "codex", "claude"])

    async def test_even_mode_rotates_across_three_providers(self):
        await self._distribute(["codex", "claude", "gemini"])

        self.assertEqual(
            await self._spawned_providers(6),
            ["codex", "claude", "gemini", "codex", "claude", "gemini"],
        )

    async def test_picks_least_loaded_provider(self):
        await self._spawn(provider="codex")
        await self._spawn(provider="codex")
        await self._spawn(provider="claude")
        await self._distribute(["codex", "claude"])

        self.assertEqual(await self._spawned_providers(2), ["claude", "codex"])

    async def test_ties_break_by_registered_provider_order(self):
        await self._distribute(["gemini", "claude"])

        self.assertEqual((await self._spawn()).provider, "claude")

    async def test_single_enabled_provider_takes_every_spawn(self):
        await self._distribute(["gemini"])

        self.assertEqual(await self._spawned_providers(3), ["gemini", "gemini", "gemini"])

    async def test_explicit_provider_overrides_distribution(self):
        await self._distribute(["codex"])

        self.assertEqual((await self._spawn(provider="claude")).provider, "claude")

    async def test_deleted_agents_do_not_count_toward_load(self):
        for _ in range(2):
            agent = await self._spawn(provider="codex")
            await Agent.where("id", agent.id).update({"deleted_at": utc_now(), "status": "deleted"})
        await self._distribute(["codex", "claude"])

        self.assertEqual((await self._spawn()).provider, "codex")

    async def test_disabled_provider_is_skipped(self):
        await self._spawn(provider="claude")
        await self._distribute(["codex", "gemini"])

        self.assertEqual(await self._spawned_providers(2), ["codex", "gemini"])

    async def test_load_is_counted_per_project(self):
        other = await ProjectFactory.new().create()
        await AgentCreateAction(
            project_id=other.id,
            request=AgentStoreRequest(name="Elsewhere", complexity="medium", provider="codex"),
        ).execute()
        await self._distribute(["codex", "claude"])

        self.assertEqual((await self._spawn()).provider, "codex")

    async def test_spawn_agent_tool_follows_distribution(self):
        await self._spawn(provider="codex")
        await self._distribute(["codex", "claude"])

        self.assertEqual((await self._spawn_via_tool()).provider, "claude")

    async def test_spawn_agent_tool_explicit_provider_wins(self):
        await self._distribute(["codex"])

        self.assertEqual((await self._spawn_via_tool(provider="gemini")).provider, "gemini")
