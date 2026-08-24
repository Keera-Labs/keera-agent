"""
Migration test for 2026_08_24_120000_migrate_removed_models_to_opus_5.

The app now offers exactly three models (ALLOWED_MODELS). Databases seeded before
the trim hold agents/templates on removed ids (e.g. the PM on claude-opus-4-8).
The data migration rewrites every out-of-range model to the default (Opus 5)
while leaving rows already on an allowed model untouched, and is idempotent.
"""

import importlib

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Agent import Agent
from app.models.AgentTemplate import AgentTemplate
from databases.factories.agent_factory import AgentFactory
from databases.factories.agent_template_factory import AgentTemplateFactory
from tests.test_case import TestCase

_migration = importlib.import_module(
    "databases.migrations.2026_08_24_120000_migrate_removed_models_to_opus_5"
)
MigrateRemovedModelsToOpus5 = _migration.MigrateRemovedModelsToOpus5


class TestMigrateRemovedModelsMigration(TestCase, DatabaseTransaction):
    async def test_agent_on_removed_model_becomes_opus_5(self):
        agent = await AgentFactory.new().create(
            project_id=1, name="mig-removed-agent", model="claude-opus-4-8"
        )

        await MigrateRemovedModelsToOpus5().up()

        self.assertEqual((await Agent.find(agent.id)).model, "claude-opus-5")

    async def test_template_on_removed_model_becomes_opus_5(self):
        tpl = await AgentTemplateFactory.new().create(
            name="mig-removed-tpl", model="claude-opus-4-6"
        )

        await MigrateRemovedModelsToOpus5().up()

        self.assertEqual((await AgentTemplate.find(tpl.id)).model, "claude-opus-5")

    async def test_leaves_allowed_models_untouched(self):
        agent = await AgentFactory.new().create(
            project_id=1, name="mig-allowed-agent", model="claude-sonnet-5"
        )
        tpl = await AgentTemplateFactory.new().create(
            name="mig-allowed-tpl", model="claude-fable-5"
        )

        await MigrateRemovedModelsToOpus5().up()

        self.assertEqual((await Agent.find(agent.id)).model, "claude-sonnet-5")
        self.assertEqual((await AgentTemplate.find(tpl.id)).model, "claude-fable-5")

    async def test_is_idempotent(self):
        agent = await AgentFactory.new().create(
            project_id=1, name="mig-idem-agent", model="claude-opus-4-8"
        )

        await MigrateRemovedModelsToOpus5().up()
        await MigrateRemovedModelsToOpus5().up()

        self.assertEqual((await Agent.find(agent.id)).model, "claude-opus-5")
