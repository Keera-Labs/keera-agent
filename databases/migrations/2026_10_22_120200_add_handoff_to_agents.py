from fastapi_startkit.masoniteorm import Migration


class AddHandoffToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.string("resume_session_id").nullable()
            table.timestamp("handed_off_at").nullable()
            table.string("handed_off_to").nullable()
            table.string("handed_off_url").nullable()

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("resume_session_id")
            table.drop_column("handed_off_at")
            table.drop_column("handed_off_to")
            table.drop_column("handed_off_url")
