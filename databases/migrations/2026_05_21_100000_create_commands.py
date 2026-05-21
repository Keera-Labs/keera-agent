"""CreateCommands Migration."""

from fastapi_startkit.masoniteorm import Migration


class CreateCommands(Migration):
    async def up(self):
        async with await self.schema.create("commands") as table:
            table.increments("id")
            table.integer("project_id")
            table.string("label")
            table.text("command")
            table.string("status").default("stopped")  # running | stopped
            table.integer("pid").nullable()
            table.timestamps()

    async def down(self):
        await self.schema.drop("commands")
