from fastapi_startkit.masoniteorm import Migration


class CreateServers(Migration):
    async def up(self):
        async with await self.schema.create("servers") as table:
            table.increments("id")
            table.string("name")
            table.string("kind").default("local")
            table.string("base_url")
            table.text("token")
            table.timestamps()

    async def down(self):
        await self.schema.drop("servers")
