"""
Feature tests for the two-tier agent-template system (task #283).

GLOBAL templates (project_id NULL) are code-seeded and edited via
/api/agent-templates. PROJECT templates (project_id set) shadow a global via
copy-on-write and are managed under /api/projects/{id}/agent-templates. A
project's effective list = override where present, else the global.
"""
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.seed_builtin_templates_action import SeedBuiltinTemplatesAction
from app.actions.sync_global_templates_action import SyncGlobalTemplatesAction
from app.constant.templates import AGENT_TEMPLATES
from app.models.AgentTemplate import AgentTemplate
from databases.factories.agent_template_factory import AgentTemplateFactory
from tests.test_case import TestCase

PID = 770283  # a scoping id that won't collide with real projects in tests


async def _make_global(*, name: str, is_builtin: bool = False, model: str = "claude-sonnet-4-6",
                       agent_type: str = "software_engineer", plan_mode: bool = False) -> AgentTemplate:
    return await AgentTemplateFactory.new().create(
        name=name, agent_type=agent_type, model=model, plan_mode=plan_mode,
        is_builtin=is_builtin, project_id=None, source_template_id=None,
    )


async def _make_override(*, name: str, source_id: int, agent_type: str = "software_engineer",
                         model: str = "claude-opus-4-8", project_id: int = PID) -> AgentTemplate:
    """A project-scoped override that shadows the global ``source_id``."""
    return await AgentTemplateFactory.new().create(
        name=name, agent_type=agent_type, model=model, is_builtin=False,
        project_id=project_id, source_template_id=source_id,
    )


class TestProjectTemplates(TestCase, DatabaseTransaction):

    async def asyncTearDown(self):
        # HTTP-app writes commit on a separate connection and are not rolled back,
        # so clear this test project's rows explicitly.
        await AgentTemplate.where("project_id", PID).delete()
        await super().asyncTearDown()

    def _names(self, payload):
        return {t["name"] for t in payload}

    def _by_name(self, payload, name):
        return next(t for t in payload if t["name"] == name)

    # ── global index is scoped to globals ─────────────────────────────────────

    async def test_global_index_excludes_project_overrides(self):
        g = await _make_global(name="t283-global-a")
        await _make_override(name="t283-override-a", agent_type="pm", source_id=g.id)
        res = await self.get("/api/agent-templates")
        res.assert_ok()
        names = self._names(res.json())
        self.assertIn("t283-global-a", names)
        self.assertNotIn("t283-override-a", names)

    # ── effective list resolution ─────────────────────────────────────────────

    async def test_effective_uses_override_when_present(self):
        g = await _make_global(name="t283-eff-base", model="claude-sonnet-4-6")
        override = await _make_override(name="t283-eff-base", source_id=g.id)
        res = await self.get(f"/api/projects/{PID}/agent-templates")
        res.assert_ok()
        row = self._by_name(res.json(), "t283-eff-base")
        # the override replaces the global in the effective list
        self.assertEqual(row["id"], override.id)
        self.assertEqual(row["model"], "claude-opus-4-8")
        self.assertTrue(row["is_override"])

    async def test_effective_falls_back_to_global(self):
        await _make_global(name="t283-eff-plain", model="claude-sonnet-4-6")
        res = await self.get(f"/api/projects/{PID}/agent-templates")
        row = self._by_name(res.json(), "t283-eff-plain")
        self.assertFalse(row["is_override"])
        self.assertIsNone(row["project_id"])

    # ── copy-on-write ─────────────────────────────────────────────────────────

    async def test_edit_global_in_project_forks_override_and_leaves_global(self):
        g = await _make_global(name="t283-cow", model="claude-sonnet-4-6")
        res = await self.patch(
            f"/api/projects/{PID}/agent-templates/{g.id}", json={"model": "claude-opus-4-8"}
        )
        res.assert_status(201).assert_json(lambda j: (
            j.where("id", lambda v: v != g.id)
             .where("project_id", PID)
             .where("source_template_id", g.id)
             .where("is_builtin", False)
             .where("model", "claude-opus-4-8")
             .etc()
        ))
        # the global itself is untouched
        fresh_global = await AgentTemplate.find(g.id)
        self.assertEqual(fresh_global.model, "claude-sonnet-4-6")

    async def test_edit_global_twice_updates_same_override(self):
        g = await _make_global(name="t283-cow2", model="claude-sonnet-4-6")
        first = await self.patch(
            f"/api/projects/{PID}/agent-templates/{g.id}", json={"model": "claude-opus-4-8"}
        )
        override_id = first.json()["id"]
        second = await self.patch(
            f"/api/projects/{PID}/agent-templates/{g.id}", json={"description": "tweaked"}
        )
        second.assert_ok().assert_json(lambda j: (
            j.where("id", override_id)  # no second override created
             .where("description", "tweaked")
             .etc()
        ))

    async def test_edit_existing_override_in_place(self):
        g = await _make_global(name="t283-cow3", model="claude-sonnet-4-6")
        override = await _make_override(name="t283-cow3", source_id=g.id)
        res = await self.patch(
            f"/api/projects/{PID}/agent-templates/{override.id}", json={"model": "claude-haiku-4-5-20251001"}
        )
        res.assert_ok().assert_json(lambda j: (
            j.where("id", override.id)
             .where("model", "claude-haiku-4-5-20251001")
             .etc()
        ))

    # ── project-only templates + delete + reset ───────────────────────────────

    async def test_project_store_creates_project_only_template(self):
        res = await self.post(
            f"/api/projects/{PID}/agent-templates", json={"name": "t283-proj-only", "agent_type": "qa"}
        )
        res.assert_status(201).assert_json(lambda j: (
            j.where("project_id", PID)
             .where("source_template_id", lambda v: v is None)
             .etc()
        ))
        eff = await self.get(f"/api/projects/{PID}/agent-templates")
        self.assertIn("t283-proj-only", self._names(eff.json()))

    async def test_project_destroy_reverts_to_global(self):
        g = await _make_global(name="t283-del", model="claude-sonnet-4-6")
        override = await _make_override(name="t283-del", source_id=g.id)
        res = await self.delete(f"/api/projects/{PID}/agent-templates/{override.id}")
        res.assert_ok()
        row = self._by_name((await self.get(f"/api/projects/{PID}/agent-templates")).json(), "t283-del")
        self.assertEqual(row["id"], g.id)  # back to the global
        self.assertFalse(row["is_override"])

    async def test_project_reset_removes_all_overrides(self):
        g = await _make_global(name="t283-reset", model="claude-sonnet-4-6")
        await _make_override(name="t283-reset", source_id=g.id)
        await self.post(
            f"/api/projects/{PID}/agent-templates", json={"name": "t283-reset-extra", "agent_type": "qa"}
        )
        res = await self.post(f"/api/projects/{PID}/agent-templates/reset")
        res.assert_ok()
        remaining = await AgentTemplate.where("project_id", PID).count()
        self.assertEqual(remaining, 0)
        names = self._names((await self.get(f"/api/projects/{PID}/agent-templates")).json())
        self.assertIn("t283-reset", names)          # global still resolved
        self.assertNotIn("t283-reset-extra", names)  # project-only template gone


class TestSeedGlobals(TestCase, DatabaseTransaction):

    async def test_seed_creates_global_with_null_project_id(self):
        name = AGENT_TEMPLATES[0].name
        await AgentTemplate.where("name", name).where_null("project_id").delete()

        await SeedBuiltinTemplatesAction().execute()

        row = await (
            AgentTemplate.where("name", name).where("is_builtin", True).where_null("project_id").first()
        )
        self.assertIsNotNone(row)
        self.assertIsNone(row.project_id)


class TestGlobalTemplateSync(TestCase, DatabaseTransaction):

    async def test_sync_overwrites_edited_global_builtin(self):
        # Start from a divergent built-in PM global, then sync from code defaults.
        await AgentTemplate.where("name", "PM").where_null("project_id").delete()
        await AgentTemplateFactory.new().create(
            name="PM", agent_type="pm", model="claude-haiku-4-5-20251001",
            system_prompt="STALE", plan_mode=True,
            is_builtin=True, project_id=None, source_template_id=None,
        )

        await SyncGlobalTemplatesAction().execute()

        pm = await AgentTemplate.where("name", "PM").where_null("project_id").first()
        self.assertEqual(pm.model, "claude-opus-4-8")  # code default
        self.assertFalse(bool(pm.plan_mode))           # PM is not a plan-mode role

    async def test_sync_leaves_project_overrides_untouched(self):
        override = await AgentTemplateFactory.new().create(
            name="PM", agent_type="pm", model="claude-haiku-4-5-20251001",
            is_builtin=False, project_id=779999, source_template_id=None,
        )
        try:
            await SyncGlobalTemplatesAction().execute()
            fresh = await AgentTemplate.find(override.id)
            self.assertEqual(fresh.model, "claude-haiku-4-5-20251001")
            self.assertEqual(fresh.project_id, 779999)
        finally:
            await AgentTemplate.where("project_id", 779999).delete()
