from fastapi_startkit.masoniteorm import Migration

_COLUMNS = ("teardown_task_version", "teardown_requeue", "teardown_report")


class AddTeardownStepsToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.string("teardown_task_version", 32).nullable()
            table.string("teardown_requeue", 16).nullable()
            table.string("teardown_report", 16).nullable()
        await self.schema.get_connection().statement(
            'UPDATE "agents" SET "teardown_requeue" = \'done\', "teardown_report" = \'done\' '
            'WHERE "deleted_at" IS NOT NULL'
        )

    async def down(self):
        async with await self.schema.table("agents") as table:
            for column in _COLUMNS:
                table.drop_column(column)
