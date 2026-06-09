"""CreateGlobalSettings Migration."""

from fastapi_startkit.masoniteorm import Migration


class CreateGlobalSettings(Migration):
    async def up(self):
        async with await self.schema.create("global_settings") as table:
            table.increments("id")
            table.string("key", 100).unique()
            table.text("value").nullable()
            table.timestamps()

    async def down(self):
        await self.schema.drop("global_settings")
