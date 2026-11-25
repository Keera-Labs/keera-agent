from fastapi_startkit.masoniteorm import Migration


class ChangeAgentTypeDefaultOnAgents(Migration):
    async def up(self):
        await self._replace_agent_type_column(default="software_engineer")

    async def down(self):
        await self._replace_agent_type_column(default="custom")

    async def _replace_agent_type_column(self, default: str):
        connection = self.schema.get_connection()
        await connection.statement(
            f'ALTER TABLE "agents" ADD COLUMN "agent_type_next" VARCHAR NOT NULL DEFAULT \'{default}\''
        )
        await connection.statement('UPDATE "agents" SET "agent_type_next" = "agent_type"')
        await connection.statement('ALTER TABLE "agents" DROP COLUMN "agent_type"')
        await connection.statement(
            'ALTER TABLE "agents" RENAME COLUMN "agent_type_next" TO "agent_type"'
        )
