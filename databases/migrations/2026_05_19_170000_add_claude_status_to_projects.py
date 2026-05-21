"""AddClaudeStatusToProjects Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddClaudeStatusToProjects(Migration):
    async def up(self):
        """
        Run the migrations.
        """
        async with await self.schema.table("projects") as table:
            table.string("claude_status").nullable()  # 'running' | 'idle' | null

    async def down(self):
        """
        Revert the migrations.
        """
        async with await self.schema.table("projects") as table:
            table.drop_column("claude_status")
