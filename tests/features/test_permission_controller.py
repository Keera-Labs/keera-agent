import json

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestPermissionController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()

    # --- agent permissions ---

    async def test_get_agent_permissions_returns_404_for_missing_agent(self):
        response = await self.get("/api/agents/999999/permissions")
        response.assert_status(404)

    async def test_get_agent_permissions_returns_agent_perms(self):
        agent = await AgentFactory.new().create(
            project_id=self.project.id,
            permissions_allow=json.dumps(["Bash(ls)"]),
            permissions_deny=json.dumps(["Bash(rm)"]),
        )
        response = await self.get(f"/api/agents/{agent.id}/permissions")
        response.assert_ok().assert_json(
            lambda j: j.where("allow", ["Bash(ls)"]).where("deny", ["Bash(rm)"]).etc()
        )

    async def test_update_agent_permissions_round_trips_and_drops_blanks(self):
        agent = await AgentFactory.new().create(project_id=self.project.id)
        response = await self.patch(
            f"/api/agents/{agent.id}/permissions",
            json={"allow": ["Bash(ls)", "", "  "], "deny": ["  Bash(rm)  "]},
        )
        response.assert_ok().assert_json(
            lambda j: j.where("allow", ["Bash(ls)"]).where("deny", ["Bash(rm)"]).etc()
        )

    async def test_update_agent_permissions_returns_404_for_missing_agent(self):
        response = await self.patch(
            "/api/agents/999999/permissions", json={"allow": [], "deny": []}
        )
        response.assert_status(404)

    # --- default permissions ---

    async def test_get_default_permissions_exposes_allow_and_deny_lists(self):
        response = await self.get("/api/default-permissions")
        response.assert_ok().assert_json(lambda j: j.has("allow").has("deny").etc())
