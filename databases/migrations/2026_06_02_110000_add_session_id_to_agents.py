"""AddSessionIdToAgents Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddSessionIdToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.string("session_id").nullable()

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("session_id")
