import importlib

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.constant.agent_types import DEFAULT_AGENT_TYPE
from app.models.Agent import Agent
from app.models.AgentTemplate import AgentTemplate
from app.requests.agent_requests import AgentUpdateRequest
from databases.factories.agent_factory import AgentFactory
from databases.factories.agent_template_factory import AgentTemplateFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

RemapLegacyAgentTypes = importlib.import_module(
    "databases.migrations.2026_11_09_163100_remap_legacy_agent_types"
).RemapLegacyAgentTypes


class TestRemapLegacyAgentTypesMigration(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()

    async def _make_agent(self, agent_type: str) -> Agent:
        return await AgentFactory.new().create(project_id=self.project.id, agent_type=agent_type)

    async def _agent_type_after_up(self, agent: Agent) -> str:
        await RemapLegacyAgentTypes().up()
        return (await Agent.find(agent.id)).agent_type

    async def test_remaps_custom_agent_to_software_engineer(self):
        agent = await self._make_agent("custom")

        self.assertEqual(await self._agent_type_after_up(agent), "software_engineer")

    async def test_remaps_qa_browser_agent_to_qa(self):
        agent = await self._make_agent("qa_browser")

        self.assertEqual(await self._agent_type_after_up(agent), "qa")

    async def test_leaves_current_agent_types_untouched(self):
        agent = await self._make_agent("reviewer")

        self.assertEqual(await self._agent_type_after_up(agent), "reviewer")

    async def test_remaps_legacy_templates(self):
        custom = await AgentTemplateFactory.new().create(agent_type="custom")
        qa_browser = await AgentTemplateFactory.new().create(agent_type="qa_browser")

        await RemapLegacyAgentTypes().up()

        self.assertEqual((await AgentTemplate.find(custom.id)).agent_type, "software_engineer")
        self.assertEqual((await AgentTemplate.find(qa_browser.id)).agent_type, "qa")

    async def test_update_request_accepts_remapped_agent_type(self):
        for legacy in ("custom", "qa_browser"):
            with self.subTest(legacy=legacy):
                agent_type = await self._agent_type_after_up(await self._make_agent(legacy))

                self.assertEqual(AgentUpdateRequest(agent_type=agent_type).agent_type, agent_type)

    async def test_patch_resending_remapped_agent_type_succeeds(self):
        agent = await self._make_agent("custom")
        await RemapLegacyAgentTypes().up()
        refreshed = await Agent.find(agent.id)

        response = await self.client.patch(
            f"/api/agents/{agent.id}",
            json={"name": refreshed.name, "agent_type": refreshed.agent_type},
        )

        self.assertEqual(response.status_code, 200, response.text)


class TestAgentTemplateAgentTypeDefault(TestCase, DatabaseTransaction):
    async def test_new_template_defaults_to_software_engineer(self):
        template = await AgentTemplate.create({"name": "Default type template"})

        self.assertEqual(
            (await AgentTemplate.find(template.id)).agent_type, DEFAULT_AGENT_TYPE.value
        )
