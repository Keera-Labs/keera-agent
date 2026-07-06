"""Reset plan_mode to False for the built-in PM template and existing PM agents.

Earlier code forced PM-type records into plan_mode=True. That is self-
contradictory: a PM coordinates the team by spawning agents and dispatching
tasks (write operations via MCP), but plan mode restricts it to read-only
tools. The application code now defaults plan_mode to False, but rows already
written to existing databases keep the bad value.

Boot re-seeding can no longer correct them — SeedBuiltinTemplatesAction is now
insert-if-missing only (it never overwrites an existing built-in row, so user
edits survive restarts). This one-off data migration is therefore the only
place that can heal already-seeded databases on upgrade.

Scope decision:
  * Built-in PM *template* — flipped to False so newly created PM agents start
    correct.
  * Existing PM *agents* — also flipped to False. A pm-type agent in plan-only
    mode can never function, and the True value was forced on it, never chosen,
    so there is no legitimate state to preserve. Only agent_type='pm' rows are
    touched; reviewer/Planner-style agents that legitimately use plan mode are
    left untouched.

Idempotent: re-running simply sets already-False rows to False again.
"""

from fastapi_startkit.masoniteorm import Migration

from app.models.Agent import Agent
from app.models.AgentTemplate import AgentTemplate


class ResetPmPlanMode(Migration):
    async def up(self):
        await (
            AgentTemplate.where("is_builtin", True)
            .where("agent_type", "pm")
            .update({"plan_mode": False})
        )
        await Agent.where("agent_type", "pm").update({"plan_mode": False})

    async def down(self):
        # Not reversible: the previous True value was a bug, and which rows held
        # it is not recorded, so there is nothing meaningful to restore.
        pass
