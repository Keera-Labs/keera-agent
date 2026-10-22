from fastapi_startkit.masoniteorm import Migration


class AddHandoffClaims(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.string("handoff_claim").nullable()
            table.timestamp("handoff_claimed_at").nullable()
        async with await self.schema.table("handoffs") as table:
            table.unique(["handoff_key", "direction"], name="handoffs_key_direction_unique")

    async def down(self):
        async with await self.schema.table("handoffs") as table:
            table.drop_unique("handoffs_key_direction_unique")
        async with await self.schema.table("agents") as table:
            table.drop_column("handoff_claim")
            table.drop_column("handoff_claimed_at")
