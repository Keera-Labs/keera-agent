import json

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestToolGatingCommand(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()

    async def _agent(self, **overrides):
        overrides.setdefault("permissions_allow", json.dumps(["Read(*)"]))
        overrides.setdefault("permissions_deny", json.dumps(["Bash(sudo *)"]))
        return await AgentFactory.new().create(project_id=self.project.id, **overrides)

    async def test_skip_permissions_omits_tool_gating_args(self):
        agent = await self._agent(dangerously_skip_permissions=True, plan_mode=False)
        cmd = agent.to_command()
        self.assertIn("--dangerously-skip-permissions", cmd)
        self.assertNotIn("--allowedTools", cmd)
        self.assertNotIn("--disallowedTools", cmd)

    async def test_enforced_permissions_emit_tool_gating_args(self):
        agent = await self._agent(dangerously_skip_permissions=False, plan_mode=False)
        cmd = agent.to_command()
        self.assertNotIn("--dangerously-skip-permissions", cmd)
        self.assertIn("--allowedTools", cmd)
        self.assertIn("--disallowedTools", cmd)

    async def test_plan_mode_keeps_tool_gating_even_when_skip_defaults_on(self):
        # plan_mode wins and enforces permissions; the independent skip column
        # defaulting to True must not strip the tool gating args.
        agent = await self._agent(dangerously_skip_permissions=True, plan_mode=True)
        cmd = agent.to_command()
        self.assertIn("--permission-mode plan", cmd)
        self.assertNotIn("--dangerously-skip-permissions", cmd)
        self.assertIn("--allowedTools", cmd)
        self.assertIn("--disallowedTools", cmd)
