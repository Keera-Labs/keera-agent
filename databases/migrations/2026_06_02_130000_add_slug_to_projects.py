"""AddSlugToProjects Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddSlugToProjects(Migration):
    async def up(self):
        async with await self.schema.table("projects") as table:
            table.string("slug").nullable()

    async def down(self):
        async with await self.schema.table("projects") as table:
            table.drop_column("slug")
