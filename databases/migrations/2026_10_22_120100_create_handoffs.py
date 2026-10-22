from fastapi_startkit.masoniteorm import Migration


class CreateHandoffs(Migration):
    async def up(self):
        async with await self.schema.create("handoffs") as table:
            table.increments("id")
            table.string("handoff_key").index()
            table.string("direction")
            table.integer("agent_id").index()
            table.integer("server_id").nullable()
            table.string("peer_url").nullable()
            table.integer("remote_agent_id").nullable()
            table.string("branch").nullable()
            table.string("session_id").nullable()
            table.string("status").default("pending")
            table.text("error").nullable()
            table.timestamps()

    async def down(self):
        await self.schema.drop("handoffs")
