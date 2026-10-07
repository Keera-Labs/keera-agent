"""CreateAgentUsageReports Migration."""

from fastapi_startkit.masoniteorm import Migration


class CreateAgentUsageReports(Migration):
    async def up(self):
        async with await self.schema.create("agent_usage_reports") as table:
            table.increments("id")
            table.integer("agent_id").unique()
            table.string("session_id").nullable()
            table.string("model").nullable()
            table.float("five_hour_used_percentage").nullable()
            table.integer("five_hour_resets_at").nullable()
            table.float("seven_day_used_percentage").nullable()
            table.integer("seven_day_resets_at").nullable()
            table.float("context_used_percentage").nullable()
            table.integer("context_window_size").nullable()
            table.timestamps()

    async def down(self):
        await self.schema.drop("agent_usage_reports")
