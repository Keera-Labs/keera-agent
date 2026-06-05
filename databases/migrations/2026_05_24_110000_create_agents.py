"""CreateAgents Migration."""

from fastapi_startkit.masoniteorm import Migration


class CreateAgents(Migration):
    async def up(self):
        async with await self.schema.create("agents") as table:
            table.id()
            table.integer("project_id")
            table.string("name")
            table.text("description").nullable()
            table.string("model").default("claude-sonnet-4-6")
            table.text("system_prompt").nullable()
            table.string("status").default("idle")  # idle | running
            table.timestamps()

    async def down(self):
        await self.schema.drop("agents")
