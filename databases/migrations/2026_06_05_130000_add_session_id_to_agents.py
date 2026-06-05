"""AddSessionIdToAgents Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddSessionIdToAgents(Migration):
    async def up(self):
        try:
            async with await self.schema.table("agents") as table:
                table.string("session_id").nullable()
        except Exception:
            pass  # column already exists

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("session_id")
