"""CreateTerminalSessions Migration."""

from fastapi_startkit.masoniteorm import Migration


class CreateTerminalSessions(Migration):
    async def up(self):
        """
        Run the migrations.
        """
        async with await self.schema.create("terminal_sessions") as table:
            table.increments("id")
            table.string("project_name")
            table.string("project_path")
            table.timestamps()

    async def down(self):
        """
        Revert the migrations.
        """
        await self.schema.drop("terminal_sessions")
