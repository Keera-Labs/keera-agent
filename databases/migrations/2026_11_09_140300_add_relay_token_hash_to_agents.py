from fastapi_startkit.masoniteorm import Migration


class AddRelayTokenHashToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.string("relay_token_hash").nullable().index()

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("relay_token_hash")
