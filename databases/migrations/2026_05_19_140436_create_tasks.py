"""CreateTasks Migration."""

from fastapi_startkit.masoniteorm import Migration


class CreateTasks(Migration):
    async def up(self):
        async with await self.schema.create("tasks") as table:
            table.increments("id")
            table.integer("project_id").unsigned()
            table.string("description")
            table.string("status").default("pending")
            table.timestamps()

    async def down(self):
        await self.schema.drop("tasks")
