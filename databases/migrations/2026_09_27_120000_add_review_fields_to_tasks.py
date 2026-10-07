"""AddReviewFieldsToTasks Migration."""

from fastapi_startkit.masoniteorm import Migration

_COLUMNS = (
    "pr_number",
    "pr_url",
    "branch",
    "additions",
    "deletions",
    "review_note",
    "progress_step",
    "progress_total",
)


class AddReviewFieldsToTasks(Migration):
    async def up(self):
        async with await self.schema.table("tasks") as table:
            table.integer("pr_number").nullable()
            table.string("pr_url").nullable()
            table.string("branch").nullable()
            table.integer("additions").nullable()
            table.integer("deletions").nullable()
            table.text("review_note").nullable()
            table.integer("progress_step").nullable()
            table.integer("progress_total").nullable()

    async def down(self):
        async with await self.schema.table("tasks") as table:
            for column in _COLUMNS:
                table.drop_column(column)
