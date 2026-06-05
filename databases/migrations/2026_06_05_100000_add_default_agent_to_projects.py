"""AddDefaultAgentToProjects Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddDefaultAgentToProjects(Migration):
    async def up(self):
        async with await self.schema.table("projects") as table:
            table.integer("default_agent_id").nullable()

    async def down(self):
        async with await self.schema.table("projects") as table:
            table.drop_column("default_agent_id")
