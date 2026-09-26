"""AddAttentionToAgents Migration.

What an agent is blocked on while its status is `needs_input`:
- attention_kind: `question` (AskUserQuestion) or `permission` (a permission prompt).
- attention_prompt: a truncated snippet of the question or permission message.
"""

from fastapi_startkit.masoniteorm import Migration


class AddAttentionToAgents(Migration):
    async def up(self):
        async with await self.schema.table("agents") as table:
            table.string("attention_kind").nullable()
            table.text("attention_prompt").nullable()

    async def down(self):
        async with await self.schema.table("agents") as table:
            table.drop_column("attention_kind")
            table.drop_column("attention_prompt")
