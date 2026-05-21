"""AddLastSessionIdToProjects Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddLastSessionIdToProjects(Migration):
    async def up(self):
        """
        Run the migrations.
        """
        async with await self.schema.table("projects") as table:
            table.integer("last_session_id").nullable()

    async def down(self):
        """
        Revert the migrations.
        """
        async with await self.schema.table("projects") as table:
            table.drop_column("last_session_id")
