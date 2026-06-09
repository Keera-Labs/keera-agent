"""AddCompletedAtToTasks Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddCompletedAtToTasks(Migration):
    async def up(self):
        async with await self.schema.table("tasks") as table:
            table.string("completed_at").nullable()

    async def down(self):
        async with await self.schema.table("tasks") as table:
            table.drop_column("completed_at")
