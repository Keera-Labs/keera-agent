from fastapi_startkit.masoniteorm import Migration


class CreateTaskEvents(Migration):
    async def up(self):
        async with await self.schema.create("task_events") as table:
            table.increments("id")
            table.integer("task_id").index()
            table.integer("actor_agent_id").nullable()
            table.string("from_status").nullable()
            table.string("to_status").nullable()
            table.json("fields_changed", nullable=True)
            table.timestamp("created_at", now=True)

    async def down(self):
        await self.schema.drop("task_events")
