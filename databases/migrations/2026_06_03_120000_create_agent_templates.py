"""CreateAgentTemplates Migration."""

from fastapi_startkit.masoniteorm import Migration


class CreateAgentTemplates(Migration):
    async def up(self):
        async with await self.schema.create("agent_templates") as table:
            table.increments("id")
            table.string("name")
            table.text("description").nullable()
            table.string("agent_type").default("custom")
            table.text("system_prompt").nullable()
            table.string("model").default("claude-sonnet-4-6")
            table.text("permissions_allow").nullable()
            table.text("permissions_deny").nullable()
            table.text("flags").nullable()  # JSON: {dangerously_skip_permissions, plan_mode, verbose, max_turns}
            table.boolean("is_builtin").default(False)
            table.timestamps()

    async def down(self):
        await self.schema.drop("agent_templates")
