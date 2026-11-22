from fastapi_startkit.masoniteorm import Migration


class AddThinkingLevelToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.string("thinking_level", 16).nullable()

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("thinking_level")
