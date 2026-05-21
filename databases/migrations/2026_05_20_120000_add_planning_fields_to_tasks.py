"""AddPlanningFieldsToTasks Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddPlanningFieldsToTasks(Migration):
    async def up(self):
        async with await self.schema.table("tasks") as table:
            table.text("acceptance_criteria").nullable()
            table.text("testing_methods").nullable()
            table.text("validation_steps").nullable()
            table.string("priority").default("medium")

    async def down(self):
        async with await self.schema.table("tasks") as table:
            table.drop_column("acceptance_criteria")
            table.drop_column("testing_methods")
            table.drop_column("validation_steps")
            table.drop_column("priority")
