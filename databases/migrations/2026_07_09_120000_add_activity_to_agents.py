"""AddActivityToAgents Migration.

Adds per-agent activity tracking used by the workspace dashboard:
- current_activity: a short description of what the agent is doing right now.
- started_at: when the current activity began (drives the elapsed timer).
"""

from fastapi_startkit.masoniteorm import Migration


class AddActivityToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.text("current_activity").nullable()
            table.timestamp("started_at").nullable()

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("current_activity")
            table.drop_column("started_at")
