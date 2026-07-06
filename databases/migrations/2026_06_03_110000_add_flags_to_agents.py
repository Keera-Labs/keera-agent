"""AddFlagsToAgents Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddFlagsToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.text(
                "flags"
            ).nullable()  # JSON: {dangerously_skip_permissions, plan_mode, verbose, max_turns}

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("flags")
