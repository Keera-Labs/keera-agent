"""Add dangerously_skip_permissions and plan_mode columns to agent_templates."""

from fastapi_startkit.masoniteorm import Migration


class AddDspPlanModeToAgentTemplates(Migration):
    async def up(self):
        async with await self.schema.table("agent_templates") as table:
            table.boolean("dangerously_skip_permissions").default(True)
            table.boolean("plan_mode").default(False)

    async def down(self):
        async with await self.schema.table("agent_templates") as table:
            table.drop_column("dangerously_skip_permissions")
            table.drop_column("plan_mode")
