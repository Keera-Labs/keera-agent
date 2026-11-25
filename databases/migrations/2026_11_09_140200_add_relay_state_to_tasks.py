from fastapi_startkit.masoniteorm import Migration

_COLUMNS = ("idempotency_key", "head_sha", "approved_sha", "merged_sha", "deleted_at")


class AddRelayStateToTasks(Migration):
    async def up(self):
        async with await self.schema.table("tasks") as table:
            table.string("idempotency_key").nullable().index()
            table.string("head_sha").nullable()
            table.string("approved_sha").nullable()
            table.string("merged_sha").nullable()
            table.timestamp("deleted_at", nullable=True)

    async def down(self):
        async with await self.schema.table("tasks") as table:
            for column in _COLUMNS:
                table.drop_column(column)
