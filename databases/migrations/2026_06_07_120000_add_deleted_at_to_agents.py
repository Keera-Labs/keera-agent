"""AddDeletedAtToAgents Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddDeletedAtToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.timestamp("deleted_at").nullable()

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("deleted_at")
