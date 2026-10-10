from fastapi_startkit.masoniteorm import Migration


class AddKindToCommands(Migration):
    async def up(self):
        async with await self.schema.table("commands") as table:
            table.string("kind").default("run")

    async def down(self):
        async with await self.schema.table("commands") as table:
            table.drop_column("kind")
