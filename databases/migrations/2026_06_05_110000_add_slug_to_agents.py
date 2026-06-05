"""AddSlugToAgents Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddSlugToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.string("slug").nullable()

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("slug")
