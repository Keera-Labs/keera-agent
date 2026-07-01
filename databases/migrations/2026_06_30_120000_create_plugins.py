"""CreatePlugins Migration."""

from fastapi_startkit.masoniteorm import Migration


class CreatePlugins(Migration):
    async def up(self):
        async with await self.schema.create("plugins") as table:
            table.increments("id")
            table.string("slug").unique()
            table.string("name")
            table.text("description").nullable()
            table.string("path").nullable()
            table.boolean("active").default(False)
            table.timestamps()

    async def down(self):
        await self.schema.drop("plugins")
