"""AddOrchestratorIdToAgents Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddOrchestratorIdToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.integer("orchestrator_id").nullable()

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("orchestrator_id")
