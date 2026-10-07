"""AddClaudeConfigDirToWorkspaces Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddClaudeConfigDirToWorkspaces(Migration):
    async def up(self):
        async with await self.schema.table("workspaces") as table:
            table.string("claude_config_dir").nullable()

    async def down(self):
        async with await self.schema.table("workspaces") as table:
            table.drop_column("claude_config_dir")
