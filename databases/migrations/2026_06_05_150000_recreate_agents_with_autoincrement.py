"""RecreateAgentsWithAutoincrement Migration.

Drops and recreates the agents table using table.id() (big_increments) instead of
table.increments("id") so that SQLite generates an AUTOINCREMENT primary key and
Agent.create() returns the correct row ID instead of always returning 1.
"""

from fastapi_startkit.masoniteorm import Migration


class RecreateAgentsWithAutoincrement(Migration):
    async def up(self):
        await self.schema.drop("agents")
        async with await self.schema.create("agents") as table:
            table.id()
            table.integer("project_id")
            table.string("name")
            table.text("description").nullable()
            table.string("model").default("claude-sonnet-4-6")
            table.text("system_prompt").nullable()
            table.string("status").default("idle")
            table.string("agent_type").default("custom")
            table.boolean("has_session").default(False)
            table.string("session_id").nullable()
            table.integer("task_id").nullable()
            table.text("permissions_allow").nullable()
            table.text("permissions_deny").nullable()
            table.text("flags").nullable()
            table.string("slug").nullable()
            table.integer("orchestrator_id").nullable()
            table.timestamps()

    async def down(self):
        await self.schema.drop("agents")
