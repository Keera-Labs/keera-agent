from fastapi_startkit.masoniteorm import Migration


class AddKindToAgentQuestions(Migration):
    async def up(self):
        async with await self.schema.table("agent_questions") as table:
            table.string("kind").default("question")

    async def down(self):
        async with await self.schema.table("agent_questions") as table:
            table.drop_column("kind")
