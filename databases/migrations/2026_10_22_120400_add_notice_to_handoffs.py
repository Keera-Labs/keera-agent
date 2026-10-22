from fastapi_startkit.masoniteorm import Migration


class AddNoticeToHandoffs(Migration):
    async def up(self):
        async with await self.schema.table("handoffs") as table:
            table.text("notice").nullable()

    async def down(self):
        async with await self.schema.table("handoffs") as table:
            table.drop_column("notice")
