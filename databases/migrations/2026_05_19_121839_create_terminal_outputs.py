"""CreateTerminalOutputs Migration."""

from fastapi_startkit.masoniteorm import Migration


class CreateTerminalOutputs(Migration):
    async def up(self):
        """
        Run the migrations.
        """
        async with await self.schema.create("terminal_outputs") as table:
            table.increments("id")
            table.integer("session_id").unsigned()
            table.text("data")
            table.timestamps()

    async def down(self):
        """
        Revert the migrations.
        """
        await self.schema.drop("terminal_outputs")
