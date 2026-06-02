"""AddFieldsToCommands Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddFieldsToCommands(Migration):
    async def up(self):
        async with await self.schema.table("commands") as table:
            table.string("description").nullable()
            table.string("category").default("General")
            table.string("shortcut").nullable()

    async def down(self):
        async with await self.schema.table("commands") as table:
            table.drop_column("description")
            table.drop_column("category")
            table.drop_column("shortcut")
