"""CreateProjects Migration."""

from fastapi_startkit.masoniteorm import Migration


class CreateProjects(Migration):
    async def up(self):
        """
        Run the migrations.
        """
        async with await self.schema.create("projects") as table:
            table.increments("id")
            table.string("name").unique()
            table.string("path")
            table.string("language").default("Unknown")
            table.timestamps()

    async def down(self):
        """
        Revert the migrations.
        """
        await self.schema.drop("projects")
