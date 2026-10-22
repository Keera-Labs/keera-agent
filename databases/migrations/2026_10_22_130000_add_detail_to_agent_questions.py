from fastapi_startkit.masoniteorm import Migration


class AddDetailToAgentQuestions(Migration):
    async def up(self):
        async with await self.schema.table("agent_questions") as table:
            table.text("detail").nullable()

    async def down(self):
        async with await self.schema.table("agent_questions") as table:
            table.drop_column("detail")
