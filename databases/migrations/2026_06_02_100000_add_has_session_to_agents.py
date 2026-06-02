"""AddHasSessionToAgents Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddHasSessionToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.boolean("has_session").default(False)

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("has_session")
