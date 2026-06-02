"""AddAgentTypeToAgents Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddAgentTypeToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.string("agent_type").default("custom")  # pm | software_engineer | qa | custom

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("agent_type")
