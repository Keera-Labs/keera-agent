from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.controllers.global_settings_controller import write_global_setting
from app.models.Agent import Agent
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestAgentProviders(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()

    async def test_create_codex_agent_persists_provider_and_builds_codex_command(self):
        response = await self.post(
            f"/api/projects/{self.project.id}/agents",
            json={
                "name": "Codex worker",
                "provider": "codex",
                "model": "gpt-5.6-terra",
                "complexity": "medium",
            },
        )

        response.assert_ok()
        attributes = response.json()["data"]["attributes"]
        self.assertEqual(attributes["provider"], "codex")
        self.assertEqual(attributes["model"], "gpt-5.6-terra")

        agent = await Agent.find(int(response.json()["data"]["id"]))
        self.assertTrue(agent.to_command().startswith("codex --model gpt-5.6-terra"))

    async def test_create_defaults_to_codex(self):
        response = await self.post(
            f"/api/projects/{self.project.id}/agents",
            json={"name": "Default worker", "complexity": "medium"},
        )

        response.assert_ok()
        attributes = response.json()["data"]["attributes"]
        self.assertEqual(attributes["provider"], "codex")
        self.assertEqual(attributes["model"], "gpt-5.6-terra")

    async def test_create_accepts_claude_opus_4_8(self):
        response = await self.post(
            f"/api/projects/{self.project.id}/agents",
            json={
                "name": "Opus worker",
                "provider": "claude",
                "model": "claude-opus-4-8",
                "complexity": "medium",
            },
        )

        response.assert_ok()
        attributes = response.json()["data"]["attributes"]
        self.assertEqual(attributes["provider"], "claude")
        self.assertEqual(attributes["model"], "claude-opus-4-8")

    async def test_create_rejects_model_from_another_provider(self):
        response = await self.post(
            f"/api/projects/{self.project.id}/agents",
            json={
                "name": "Wrong model",
                "provider": "codex",
                "model": "claude-opus-5",
                "complexity": "medium",
            },
        )

        response.assert_status(422)
        self.assertIn("not configured for codex", response.json()["error"])

    async def test_update_changes_provider_and_model_together(self):
        created = await self.post(
            f"/api/projects/{self.project.id}/agents",
            json={"name": "Switch me", "complexity": "medium"},
        )
        agent_id = int(created.json()["data"]["id"])

        response = await self.patch(
            f"/api/agents/{agent_id}",
            json={"provider": "codex", "model": "gpt-5.6-terra"},
        )

        response.assert_ok()
        self.assertEqual(response.json()["data"]["attributes"]["provider"], "codex")

    async def test_custom_global_model_can_be_selected(self):
        await write_global_setting(
            "provider_models",
            {"claude": ["claude-custom"], "codex": ["codex-custom"]},
        )

        response = await self.post(
            f"/api/projects/{self.project.id}/agents",
            json={
                "name": "Custom model",
                "provider": "codex",
                "model": "codex-custom",
                "complexity": "hard",
            },
        )

        response.assert_ok()
        attributes = response.json()["data"]["attributes"]
        self.assertEqual(attributes["model"], "codex-custom")
