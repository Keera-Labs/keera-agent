"""Heal agents and templates still pointing at a now-removed model.

The app was trimmed to exactly three selectable models (see ALLOWED_MODELS in
app/constant/complexity.py): claude-opus-5, claude-sonnet-5, claude-fable-5.
Databases seeded before that trim hold agents/templates on removed ids — most
notably the built-in PM and its agents on the old default claude-opus-4-8, plus
Software Engineer/QA/Full Auto templates on claude-opus-4-6. A row pointing at a
model the CLI no longer accepts can never boot, so this one-off migration
rewrites every out-of-range model to the new default (claude-opus-5).

Idempotent: rows already on an allowed model are left untouched, so re-running
is a no-op.
"""

from fastapi_startkit.masoniteorm import Migration

from app.constant.complexity import ALLOWED_MODELS, DEFAULT_MODEL
from app.models.Agent import Agent
from app.models.AgentTemplate import AgentTemplate


class MigrateRemovedModelsToOpus5(Migration):
    async def up(self):
        await Agent.where_not_in("model", list(ALLOWED_MODELS)).update({"model": DEFAULT_MODEL})
        await AgentTemplate.where_not_in("model", list(ALLOWED_MODELS)).update(
            {"model": DEFAULT_MODEL}
        )

    async def down(self):
        # Not reversible: the previous (removed) model ids are not recorded, and
        # they are no longer valid models to restore to.
        pass
