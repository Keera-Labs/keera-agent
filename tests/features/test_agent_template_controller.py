"""
Feature tests for agent_template_controller + SeedBuiltinTemplatesAction.

Covers task #190 — built-in templates are now fully editable (model + all
fields) via PATCH, deletion of built-ins stays blocked, and startup seeding is
insert-if-missing only so user edits to built-ins survive a re-seed.
"""
import json

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.seed_builtin_templates_action import SeedBuiltinTemplatesAction
from app.constant.templates import AGENT_TEMPLATES
from app.models.AgentTemplate import AgentTemplate
from tests.test_case import TestCase


async def _make_template(*, name: str, is_builtin: bool, model: str = "claude-sonnet-4-6",
                         system_prompt: str | None = "orig prompt") -> AgentTemplate:
    return await AgentTemplate.create({
        "name": name,
        "description": "orig desc",
        "agent_type": "software_engineer",
        "system_prompt": system_prompt,
        "model": model,
        "flags": json.dumps({}),
        "permissions_allow": json.dumps([]),
        "permissions_deny": json.dumps([]),
        "dangerously_skip_permissions": True,
        "plan_mode": False,
        "is_builtin": is_builtin,
    })


class TestAgentTemplateController(TestCase, DatabaseTransaction):

    # ── PATCH built-ins are now editable ──────────────────────────────────────

    async def test_patch_builtin_updates_model(self):
        tpl = await _make_template(name="tmpl190-builtin-model", is_builtin=True, model="claude-sonnet-4-6")
        res = await self.client.patch(f"/api/agent-templates/{tpl.id}", json={"model": "claude-opus-4-8"})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["model"], "claude-opus-4-8")
        self.assertTrue(body["is_builtin"])

    async def test_patch_builtin_updates_full_fields(self):
        tpl = await _make_template(name="tmpl190-builtin-full", is_builtin=True)
        res = await self.client.patch(
            f"/api/agent-templates/{tpl.id}",
            json={"system_prompt": "edited prompt", "description": "edited desc", "model": "claude-haiku-4-5-20251001"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["system_prompt"], "edited prompt")
        self.assertEqual(body["description"], "edited desc")
        self.assertEqual(body["model"], "claude-haiku-4-5-20251001")

    # ── DELETE of built-ins stays blocked ─────────────────────────────────────

    async def test_delete_builtin_still_forbidden(self):
        tpl = await _make_template(name="tmpl190-builtin-del", is_builtin=True)
        res = await self.client.delete(f"/api/agent-templates/{tpl.id}")
        self.assertEqual(res.status_code, 403)

    # ── user templates still behave ───────────────────────────────────────────

    async def test_patch_user_template_updates(self):
        tpl = await _make_template(name="tmpl190-user-edit", is_builtin=False)
        res = await self.client.patch(f"/api/agent-templates/{tpl.id}", json={"model": "claude-opus-4-8"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["model"], "claude-opus-4-8")

    async def test_delete_user_template_ok(self):
        tpl = await _make_template(name="tmpl190-user-del", is_builtin=False)
        res = await self.client.delete(f"/api/agent-templates/{tpl.id}")
        self.assertEqual(res.status_code, 200)

    async def test_patch_missing_template_returns_404(self):
        res = await self.client.patch("/api/agent-templates/99999999", json={"model": "claude-opus-4-8"})
        self.assertEqual(res.status_code, 404)

    # ── seeding is insert-if-missing only ─────────────────────────────────────

    async def test_seed_does_not_overwrite_existing_builtin(self):
        """An existing built-in's user edits (model + prompt) survive re-seed."""
        seed_name = AGENT_TEMPLATES[0].name  # a real built-in name the seeder iterates
        edited = await _make_template(
            name=seed_name, is_builtin=True,
            model="claude-haiku-4-5-20251001", system_prompt="USER EDITED PROMPT",
        )

        await SeedBuiltinTemplatesAction().execute()

        refreshed = await AgentTemplate.find(edited.id)
        self.assertEqual(refreshed.model, "claude-haiku-4-5-20251001")
        self.assertEqual(refreshed.system_prompt, "USER EDITED PROMPT")
