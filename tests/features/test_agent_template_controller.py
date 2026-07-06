"""
Feature tests for agent_template_controller + SeedBuiltinTemplatesAction.

Covers task #190 — built-in templates are now fully editable (model + all
fields) via PATCH, deletion of built-ins stays blocked, and startup seeding is
insert-if-missing only so user edits to built-ins survive a re-seed.
"""

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.seed_builtin_templates_action import SeedBuiltinTemplatesAction
from app.constant.templates import AGENT_TEMPLATES
from app.models.AgentTemplate import AgentTemplate
from databases.factories.agent_template_factory import AgentTemplateFactory
from tests.test_case import TestCase


class TestAgentTemplateController(TestCase, DatabaseTransaction):
    # ── PATCH built-ins are now editable ──────────────────────────────────────

    async def test_patch_builtin_updates_model(self):
        tpl = await AgentTemplateFactory.new().create(
            name="tmpl190-builtin-model", is_builtin=True, model="claude-sonnet-4-6"
        )
        res = await self.patch(f"/api/agent-templates/{tpl.id}", json={"model": "claude-opus-4-8"})
        res.assert_ok().assert_json(
            lambda j: j.where("model", "claude-opus-4-8").where("is_builtin", True).etc()
        )

    async def test_patch_builtin_updates_full_fields(self):
        tpl = await AgentTemplateFactory.new().create(name="tmpl190-builtin-full", is_builtin=True)
        res = await self.patch(
            f"/api/agent-templates/{tpl.id}",
            json={
                "system_prompt": "edited prompt",
                "description": "edited desc",
                "model": "claude-haiku-4-5-20251001",
            },
        )
        res.assert_ok().assert_json(
            lambda j: (
                j.where("system_prompt", "edited prompt")
                .where("description", "edited desc")
                .where("model", "claude-haiku-4-5-20251001")
                .etc()
            )
        )

    # ── DELETE of built-ins stays blocked ─────────────────────────────────────

    async def test_delete_builtin_still_forbidden(self):
        tpl = await AgentTemplateFactory.new().create(name="tmpl190-builtin-del", is_builtin=True)
        res = await self.delete(f"/api/agent-templates/{tpl.id}")
        res.assert_status(403)

    # ── user templates still behave ───────────────────────────────────────────

    async def test_patch_user_template_updates(self):
        tpl = await AgentTemplateFactory.new().create(name="tmpl190-user-edit", is_builtin=False)
        res = await self.patch(f"/api/agent-templates/{tpl.id}", json={"model": "claude-opus-4-8"})
        res.assert_ok().assert_json(lambda j: j.where("model", "claude-opus-4-8").etc())

    async def test_delete_user_template_ok(self):
        tpl = await AgentTemplateFactory.new().create(name="tmpl190-user-del", is_builtin=False)
        res = await self.delete(f"/api/agent-templates/{tpl.id}")
        res.assert_ok()

    async def test_patch_missing_template_returns_404(self):
        res = await self.patch("/api/agent-templates/99999999", json={"model": "claude-opus-4-8"})
        res.assert_status(404)

    # ── seeding is insert-if-missing only ─────────────────────────────────────

    async def test_seed_does_not_overwrite_existing_builtin(self):
        """An existing built-in's user edits (model + prompt) survive re-seed."""
        seed_name = AGENT_TEMPLATES[0].name  # a real built-in name the seeder iterates
        edited = await AgentTemplateFactory.new().create(
            name=seed_name,
            is_builtin=True,
            model="claude-haiku-4-5-20251001",
            system_prompt="USER EDITED PROMPT",
        )

        await SeedBuiltinTemplatesAction().execute()

        refreshed = await AgentTemplate.find(edited.id)
        self.assertEqual(refreshed.model, "claude-haiku-4-5-20251001")
        self.assertEqual(refreshed.system_prompt, "USER EDITED PROMPT")
