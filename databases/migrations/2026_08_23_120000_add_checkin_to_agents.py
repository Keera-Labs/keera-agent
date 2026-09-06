"""AddCheckinToAgents Migration.

Persists the UI-started PM check-in scheduler state on the PM agent row:
- checkin_enabled: whether the periodic check-in ping is active.
- checkin_interval_minutes: how often (minutes) to ping while a task is in_progress.
"""

from fastapi_startkit.masoniteorm import Migration


class AddCheckinToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.boolean("checkin_enabled").default(False)
            table.integer("checkin_interval_minutes").default(5)

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("checkin_enabled")
            table.drop_column("checkin_interval_minutes")
