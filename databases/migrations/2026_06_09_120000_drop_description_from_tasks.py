"""DropDescriptionFromTasks Migration."""

from fastapi_startkit.masoniteorm import Migration


class DropDescriptionFromTasks(Migration):
    async def up(self):
        async with await self.schema.table("tasks") as table:
            table.drop_column("description")

    async def down(self):
        async with await self.schema.table("tasks") as table:
            table.string("description").default("")
