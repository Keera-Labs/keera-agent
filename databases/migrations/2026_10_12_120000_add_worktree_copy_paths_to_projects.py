from fastapi_startkit.masoniteorm import Migration


class AddWorktreeCopyPathsToProjects(Migration):
    async def up(self):
        async with await self.schema.table("projects") as table:
            table.text("worktree_copy_paths").nullable()

    async def down(self):
        connection = self.schema.get_connection()
        await connection.statement('ALTER TABLE "projects" DROP COLUMN "worktree_copy_paths"')
