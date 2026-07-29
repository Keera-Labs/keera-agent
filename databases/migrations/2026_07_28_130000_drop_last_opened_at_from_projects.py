"""DropLastOpenedAtFromProjects Migration."""

from fastapi_startkit.masoniteorm import Migration


class DropLastOpenedAtFromProjects(Migration):
    async def up(self):
        """
        Run the migrations.

        Uses a raw ALTER TABLE instead of the schema builder's drop_column():
        that helper rebuilds the whole table on SQLite and mis-declares the
        other nullable integer FK columns (last_session_id, default_agent_id)
        as additional PRIMARY KEY AUTOINCREMENT columns, which SQLite rejects.
        A direct DROP COLUMN (native since SQLite 3.35) sidesteps the rebuild.
        """
        connection = self.schema.get_connection()
        await connection.statement('ALTER TABLE "projects" DROP COLUMN "last_opened_at"')

    async def down(self):
        """
        Revert the migrations.
        """
        async with await self.schema.table("projects") as table:
            table.datetime("last_opened_at").nullable()
