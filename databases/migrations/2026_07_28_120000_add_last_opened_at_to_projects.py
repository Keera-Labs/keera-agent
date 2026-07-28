"""AddLastOpenedAtToProjects Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddLastOpenedAtToProjects(Migration):
    async def up(self):
        """
        Run the migrations.
        """
        async with await self.schema.table("projects") as table:
            table.datetime("last_opened_at").nullable()

    async def down(self):
        """
        Revert the migrations.
        """
        async with await self.schema.table("projects") as table:
            table.drop_column("last_opened_at")
