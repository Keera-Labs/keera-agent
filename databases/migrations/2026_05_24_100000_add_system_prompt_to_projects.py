"""AddSystemPromptToProjects Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddSystemPromptToProjects(Migration):
    async def up(self):
        async with await self.schema.table("projects") as table:
            table.text("system_prompt").nullable()

    async def down(self):
        async with await self.schema.table("projects") as table:
            table.drop_column("system_prompt")
