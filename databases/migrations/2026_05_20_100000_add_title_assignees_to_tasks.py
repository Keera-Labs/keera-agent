"""AddTitleAssigneesToTasks Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddTitleAssigneesToTasks(Migration):
    async def up(self):
        async with await self.schema.table("tasks") as table:
            table.string("title").nullable()
            table.text("body").nullable()
            table.text("assignees").nullable()

    async def down(self):
        async with await self.schema.table("tasks") as table:
            table.drop_column("title")
            table.drop_column("body")
            table.drop_column("assignees")
