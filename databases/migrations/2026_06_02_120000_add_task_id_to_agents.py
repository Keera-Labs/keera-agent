"""AddTaskIdToAgents Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddTaskIdToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.integer("task_id").nullable()

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("task_id")
