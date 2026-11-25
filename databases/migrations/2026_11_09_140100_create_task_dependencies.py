from fastapi_startkit.masoniteorm import Migration


class CreateTaskDependencies(Migration):
    async def up(self):
        async with await self.schema.create("task_dependencies") as table:
            table.increments("id")
            table.integer("task_id").index()
            table.integer("depends_on_task_id").index()
            table.boolean("hard").default(False)
            table.timestamps()
            table.unique(["task_id", "depends_on_task_id"])

    async def down(self):
        await self.schema.drop("task_dependencies")
