"""CreateAgentMessages Migration."""

from fastapi_startkit.masoniteorm import Migration


class CreateAgentMessages(Migration):
    async def up(self):
        async with await self.schema.create("agent_messages") as table:
            table.increments("id")
            table.integer("sender_project_id")
            table.integer("receiver_project_id")
            table.text("content")
            table.string("status").default("pending")  # pending | delivered | read
            table.timestamps()

    async def down(self):
        await self.schema.drop("agent_messages")
