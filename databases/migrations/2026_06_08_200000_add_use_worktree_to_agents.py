"""AddUseWorktreeToAgents Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddUseWorktreeToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.boolean("use_worktree").default(True)

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("use_worktree")
