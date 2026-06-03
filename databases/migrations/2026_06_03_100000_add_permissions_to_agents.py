"""AddPermissionsToAgents Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddPermissionsToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.text("permissions_allow").nullable()
            table.text("permissions_deny").nullable()

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("permissions_allow")
            table.drop_column("permissions_deny")
