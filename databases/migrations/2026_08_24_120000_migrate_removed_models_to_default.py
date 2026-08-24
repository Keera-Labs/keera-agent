"""Heal agents and templates still pointing at a now-removed model.

The app was trimmed to exactly three selectable models (see ALLOWED_MODELS in
app/constant/complexity.py): claude-opus-4-8 (the "Opus 5" tier), claude-sonnet-5,
and claude-fable-5. Databases seeded before that trim hold agents/templates on
removed ids — e.g. Software Engineer/QA/Full Auto templates on claude-opus-4-6,
or older rows on claude-sonnet-4-6 / claude-haiku-4-5. A row on a model no longer
offered should not linger, so this one-off migration rewrites every out-of-range
model to the default (claude-opus-4-8).

Rows already on an allowed model — including the built-in PM on claude-opus-4-8 —
are left untouched, so this never moves a working agent onto a different model.
Idempotent: re-running is a no-op.
"""

from fastapi_startkit.masoniteorm import Migration

from app.constant.complexity import ALLOWED_MODELS, DEFAULT_MODEL
from app.models.Agent import Agent
from app.models.AgentTemplate import AgentTemplate


class MigrateRemovedModelsToDefault(Migration):
    async def up(self):
        await Agent.where_not_in("model", list(ALLOWED_MODELS)).update({"model": DEFAULT_MODEL})
        await AgentTemplate.where_not_in("model", list(ALLOWED_MODELS)).update(
            {"model": DEFAULT_MODEL}
        )

    async def down(self):
        # Not reversible: the previous (removed) model ids are not recorded, and
        # they are no longer valid models to restore to.
        pass
