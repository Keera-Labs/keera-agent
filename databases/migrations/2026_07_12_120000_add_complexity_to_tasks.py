"""AddComplexityToTasks Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddComplexityToTasks(Migration):
    async def up(self):
        async with await self.schema.table("tasks") as table:
            table.string("complexity").nullable()

    async def down(self):
        async with await self.schema.table("tasks") as table:
            table.drop_column("complexity")
