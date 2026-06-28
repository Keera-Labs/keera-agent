"""CreateStudents Migration."""

from fastapi_startkit.masoniteorm import Migration


class CreateStudents(Migration):
    async def up(self):
        async with await self.schema.create("students") as table:
            table.id()
            table.string("name").nullable()
            table.string("email").unique()
            table.string("password")
            table.timestamps()

    async def down(self):
        await self.schema.drop("students")
