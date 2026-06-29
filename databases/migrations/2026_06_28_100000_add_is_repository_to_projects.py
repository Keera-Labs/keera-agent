"""AddIsRepositoryToProjects Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddIsRepositoryToProjects(Migration):
    async def up(self):
        async with await self.schema.table("projects") as table:
            table.boolean("is_repository").default(False)

    async def down(self):
        async with await self.schema.table("projects") as table:
            table.drop_column("is_repository")
