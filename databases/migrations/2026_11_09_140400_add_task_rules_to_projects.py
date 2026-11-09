from fastapi_startkit.masoniteorm import Migration


class AddTaskRulesToProjects(Migration):
    async def up(self):
        async with await self.schema.table("projects") as table:
            table.string("task_rules").default("warn")

    async def down(self):
        async with await self.schema.table("projects") as table:
            table.drop_column("task_rules")
