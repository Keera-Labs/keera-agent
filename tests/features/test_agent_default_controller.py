"""
Feature tests for the project default-agent endpoints:
- GET  /api/projects/{project_id}/default-agent  (agent_default_controller.show)
- POST /api/projects/{project_id}/default-agent  (agent_default_controller.store)
"""

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestAgentDefaultController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()

    @property
    def url(self) -> str:
        return f"/api/projects/{self.project.id}/default-agent"

    @staticmethod
    def _returned_agent_id(response) -> int:
        return int(response.json()["data"]["id"])

    # --- show ---

    async def test_show_returns_null_when_project_has_no_agents(self):
        response = await self.get(self.url)
        response.assert_ok()
        assert response.json() is None

    async def test_show_falls_back_to_first_agent_by_id(self):
        first = await AgentFactory.new().create(project_id=self.project.id)
        await AgentFactory.new().create(project_id=self.project.id)

        response = await self.get(self.url)
        response.assert_ok()
        assert self._returned_agent_id(response) == first.id

    async def test_show_returns_explicit_default(self):
        await AgentFactory.new().create(project_id=self.project.id)
        chosen = await AgentFactory.new().create(project_id=self.project.id)

        (await self.post(self.url, json={"agent_id": chosen.id})).assert_ok()

        response = await self.get(self.url)
        response.assert_ok()
        assert self._returned_agent_id(response) == chosen.id

    # --- store ---

    async def test_store_sets_default_agent(self):
        agent = await AgentFactory.new().create(project_id=self.project.id)

        response = await self.post(self.url, json={"agent_id": agent.id})
        response.assert_ok()
        assert self._returned_agent_id(response) == agent.id

    async def test_store_missing_agent_id_returns_422(self):
        response = await self.post(self.url, json={})
        response.assert_status(422)

    async def test_store_non_positive_agent_id_returns_422(self):
        response = await self.post(self.url, json={"agent_id": 0})
        response.assert_status(422)

    async def test_store_agent_from_another_project_returns_404(self):
        other_project = await ProjectFactory.new().create()
        other_agent = await AgentFactory.new().create(project_id=other_project.id)

        response = await self.post(self.url, json={"agent_id": other_agent.id})
        response.assert_status(404)

    async def test_store_unknown_agent_returns_404(self):
        response = await self.post(self.url, json={"agent_id": 999999})
        response.assert_status(404)
