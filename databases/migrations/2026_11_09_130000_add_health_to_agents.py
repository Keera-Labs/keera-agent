from fastapi_startkit.masoniteorm import Migration

_COLUMNS = (
    "last_heartbeat_at",
    "heartbeat_note",
    "worktree_branch",
    "worktree_head_sha",
    "worktree_last_commit_at",
    "worktree_last_change_at",
    "deleted_reason",
)


class AddHealthToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.timestamp("last_heartbeat_at").nullable()
            table.string("heartbeat_note", 140).nullable()
            table.string("worktree_branch").nullable()
            table.string("worktree_head_sha", 40).nullable()
            table.timestamp("worktree_last_commit_at").nullable()
            table.timestamp("worktree_last_change_at").nullable()
            table.string("deleted_reason").nullable()
        await self.schema.get_connection().statement(
            'UPDATE "agents" SET "status" = \'deleted\' WHERE "deleted_at" IS NOT NULL'
        )

    async def down(self):
        async with await self.schema.table("agents") as table:
            for column in _COLUMNS:
                table.drop_column(column)
