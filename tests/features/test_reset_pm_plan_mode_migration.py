"""
Migration test for 2026_06_20_100000_reset_pm_plan_mode.

Boot re-seeding is insert-if-missing only (task #190), so it can no longer heal
the forced plan_mode=True that older code wrote to PM-type rows on existing
databases. The data migration must do it. This verifies it flips the built-in PM
template and existing PM agents to plan_mode=False while leaving rows that
legitimately use plan mode (e.g. reviewer/Planner) untouched, and that it is
idempotent.
"""
import importlib
import json

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Agent import Agent
from app.models.AgentTemplate import AgentTemplate
from tests.test_case import TestCase

_migration = importlib.import_module(
    "databases.migrations.2026_06_20_100000_reset_pm_plan_mode"
)
ResetPmPlanMode = _migration.ResetPmPlanMode


async def _make_template(*, name: str, agent_type: str, is_builtin: bool, plan_mode: bool) -> AgentTemplate:
    return await AgentTemplate.create({
        "name": name,
        "description": "d",
        "agent_type": agent_type,
        "system_prompt": "p",
        "model": "claude-sonnet-4-6",
        "flags": json.dumps({}),
        "permissions_allow": json.dumps([]),
        "permissions_deny": json.dumps([]),
        "dangerously_skip_permissions": True,
        "plan_mode": plan_mode,
        "is_builtin": is_builtin,
    })


async def _make_agent(*, name: str, agent_type: str, plan_mode: bool) -> Agent:
    return await Agent.create({
        "project_id": 1,
        "name": name,
        "agent_type": agent_type,
        "model": "claude-sonnet-4-6",
        "plan_mode": plan_mode,
        "status": "idle",
    })


class TestResetPmPlanModeMigration(TestCase, DatabaseTransaction):

    async def test_flips_builtin_pm_template_to_false(self):
        tpl = await _make_template(name="PM-mig", agent_type="pm", is_builtin=True, plan_mode=True)

        await ResetPmPlanMode().up()

        refreshed = await AgentTemplate.find(tpl.id)
        self.assertFalse(bool(refreshed.plan_mode))

    async def test_flips_existing_pm_agents_to_false(self):
        agent = await _make_agent(name="PM-agent-mig", agent_type="pm", plan_mode=True)

        await ResetPmPlanMode().up()

        refreshed = await Agent.find(agent.id)
        self.assertFalse(bool(refreshed.plan_mode))

    async def test_leaves_non_pm_plan_mode_untouched(self):
        tpl = await _make_template(name="Planner-mig", agent_type="reviewer", is_builtin=True, plan_mode=True)
        agent = await _make_agent(name="Reviewer-agent-mig", agent_type="reviewer", plan_mode=True)

        await ResetPmPlanMode().up()

        self.assertTrue(bool((await AgentTemplate.find(tpl.id)).plan_mode))
        self.assertTrue(bool((await Agent.find(agent.id)).plan_mode))

    async def test_is_idempotent(self):
        tpl = await _make_template(name="PM-idem", agent_type="pm", is_builtin=True, plan_mode=True)
        agent = await _make_agent(name="PM-agent-idem", agent_type="pm", plan_mode=True)

        await ResetPmPlanMode().up()
        await ResetPmPlanMode().up()

        self.assertFalse(bool((await AgentTemplate.find(tpl.id)).plan_mode))
        self.assertFalse(bool((await Agent.find(agent.id)).plan_mode))
