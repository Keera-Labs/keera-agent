"""AddWorktreeCopyPathsToProjects Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddWorktreeCopyPathsToProjects(Migration):
    async def up(self):
        async with await self.schema.table("projects") as table:
            table.text("worktree_copy_paths").nullable()

    async def down(self):
        # Raw DROP COLUMN: the schema builder's drop_column() rebuilds the table on SQLite
        # and mis-declares the nullable integer FK columns as extra primary keys.
        connection = self.schema.get_connection()
        await connection.statement('ALTER TABLE "projects" DROP COLUMN "worktree_copy_paths"')
