"""CreateWorkspaces Migration."""

from fastapi_startkit.masoniteorm import Migration


class CreateWorkspaces(Migration):
    async def up(self):
        """
        Run the migrations.
        """
        async with await self.schema.create("workspaces") as table:
            table.increments("id")
            table.string("name")
            table.string("description").nullable()
            table.timestamps()

    async def down(self):
        """
        Revert the migrations.
        """
        await self.schema.drop("workspaces")
