"""Add project scoping to agent_templates for the two-tier template system.

- project_id NULL  → a GLOBAL template (code-seeded built-ins + user globals).
- project_id set   → a PROJECT-scoped override that shadows a global for one
                     project (copy-on-write); never mutates the global row.
- source_template_id → for an override, the id of the global template it shadows
                     (NULL for globals and for templates created fresh inside a
                     project). Used to resolve the effective list and to survive
                     renames of the override.
"""

from fastapi_startkit.masoniteorm import Migration


class AddProjectScopeToAgentTemplates(Migration):
    async def up(self):
        async with await self.schema.table("agent_templates") as table:
            table.integer("project_id").nullable()
            table.integer("source_template_id").nullable()

    async def down(self):
        async with await self.schema.table("agent_templates") as table:
            table.drop_column("project_id")
            table.drop_column("source_template_id")
