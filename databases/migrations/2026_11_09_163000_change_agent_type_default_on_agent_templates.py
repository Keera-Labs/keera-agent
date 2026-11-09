from fastapi_startkit.masoniteorm import Migration

from app.constant.agent_types import DEFAULT_AGENT_TYPE


class ChangeAgentTypeDefaultOnAgentTemplates(Migration):
    async def up(self):
        await self._replace_agent_type_column(default=DEFAULT_AGENT_TYPE.value)

    async def down(self):
        await self._replace_agent_type_column(default="custom")

    async def _replace_agent_type_column(self, default: str):
        connection = self.schema.get_connection()
        await connection.statement(
            f'ALTER TABLE "agent_templates" ADD COLUMN "agent_type_next" VARCHAR NOT NULL DEFAULT \'{default}\''
        )
        await connection.statement('UPDATE "agent_templates" SET "agent_type_next" = "agent_type"')
        await connection.statement('ALTER TABLE "agent_templates" DROP COLUMN "agent_type"')
        await connection.statement(
            'ALTER TABLE "agent_templates" RENAME COLUMN "agent_type_next" TO "agent_type"'
        )
