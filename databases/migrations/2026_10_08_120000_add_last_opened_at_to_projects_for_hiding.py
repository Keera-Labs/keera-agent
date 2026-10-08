"""AddLastOpenedAtToProjectsForHiding Migration."""

from fastapi_startkit.masoniteorm import Migration


class AddLastOpenedAtToProjectsForHiding(Migration):
    async def up(self):
        async with await self.schema.table("projects") as table:
            table.datetime("last_opened_at").nullable()

        # NULL means hidden from the sidebar, so every existing project is backfilled to stay visible.
        connection = self.schema.get_connection()
        await connection.statement(
            'UPDATE "projects" SET "last_opened_at" = '
            'COALESCE("updated_at", "created_at", CURRENT_TIMESTAMP)'
        )

    async def down(self):
        # Raw DROP COLUMN: the schema builder's drop_column() rebuilds the table on SQLite
        # and mis-declares the nullable integer FK columns as extra primary keys.
        connection = self.schema.get_connection()
        await connection.statement('ALTER TABLE "projects" DROP COLUMN "last_opened_at"')
