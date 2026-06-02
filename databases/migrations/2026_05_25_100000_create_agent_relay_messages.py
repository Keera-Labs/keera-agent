"""CreateAgentRelayMessages Migration."""

from fastapi_startkit.masoniteorm import Migration


class CreateAgentRelayMessages(Migration):
    async def up(self):
        async with await self.schema.create("agent_relay_messages") as table:
            table.increments("id")
            table.integer("from_agent_id")
            table.integer("to_agent_id")
            table.text("content")
            table.string("status").default("pending")   # pending | delivered
            table.timestamps()

    async def down(self):
        await self.schema.drop("agent_relay_messages")
