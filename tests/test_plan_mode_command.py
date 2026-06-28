from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestPlanModeCommand(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()

    async def _agent(self, **overrides):
        return await AgentFactory.new().create(project_id=self.project.id, **overrides)

    async def test_plan_mode_uses_cli_flag_not_skip_permissions(self):
        agent = await self._agent(plan_mode=True, dangerously_skip_permissions=True)
        cmd = agent.to_command()
        self.assertIn("--permission-mode plan", cmd)
        self.assertNotIn("--dangerously-skip-permissions", cmd)

    async def test_non_plan_mode_with_toggle_on_skips_permissions(self):
        agent = await self._agent(plan_mode=False, dangerously_skip_permissions=True)
        cmd = agent.to_command()
        self.assertIn("--dangerously-skip-permissions", cmd)
        self.assertNotIn("--permission-mode", cmd)

    async def test_non_plan_mode_with_toggle_off_emits_neither_flag(self):
        agent = await self._agent(plan_mode=False, dangerously_skip_permissions=False)
        cmd = agent.to_command()
        self.assertNotIn("--dangerously-skip-permissions", cmd)
        self.assertNotIn("--permission-mode", cmd)

    async def test_plan_mode_does_not_inject_prompt_text(self):
        agent = await self._agent(plan_mode=True)
        self.assertNotIn("PLAN-ONLY", agent.to_command())
