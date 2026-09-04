from fastapi_startkit.masoniteorm import Migration


class AddProviderToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.string("provider").default("claude")

        async with await self.schema.table("agent_templates") as table:
            table.string("provider").default("claude")

    async def down(self):
        async with await self.schema.table("agent_templates") as table:
            table.drop_column("provider")

        async with await self.schema.table("agents") as table:
            table.drop_column("provider")
