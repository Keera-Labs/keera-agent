"""AddWorkspaceIdToProjects Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddWorkspaceIdToProjects(Migration):
    async def up(self):
        """
        Run the migrations.
        """
        async with await self.schema.table("projects") as table:
            table.unsigned_integer("workspace_id").nullable()

    async def down(self):
        """
        Revert the migrations.
        """
        async with await self.schema.table("projects") as table:
            table.drop_column("workspace_id")
