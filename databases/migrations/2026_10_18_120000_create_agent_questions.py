from fastapi_startkit.masoniteorm import Migration


class CreateAgentQuestions(Migration):
    async def up(self):
        async with await self.schema.create("agent_questions") as table:
            table.increments("id")
            table.integer("agent_id").index()
            table.integer("project_id").nullable()
            table.string("session_id").nullable()
            table.string("tool_use_id").nullable().index()
            table.integer("position").default(0)
            table.text("question")
            table.string("header").nullable()
            table.text("options").nullable()
            table.boolean("multi_select").default(False)
            table.string("status").default("pending")
            table.text("answer").nullable()
            table.timestamp("answered_at").nullable()
            table.timestamps()

    async def down(self):
        await self.schema.drop("agent_questions")
