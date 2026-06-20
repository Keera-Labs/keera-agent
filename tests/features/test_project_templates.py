"""
Feature tests for the two-tier agent-template system (task #283).

GLOBAL templates (project_id NULL) are code-seeded and edited via
/api/agent-templates. PROJECT templates (project_id set) shadow a global via
copy-on-write and are managed under /api/projects/{id}/agent-templates. A
project's effective list = override where present, else the global.
"""
import json

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.sync_global_templates_action import SyncGlobalTemplatesAction
from app.models.AgentTemplate import AgentTemplate
from tests.test_case import TestCase

PID = 770283  # a scoping id that won't collide with real projects in tests


async def _make_global(*, name: str, is_builtin: bool = False, model: str = "claude-sonnet-4-6",
                       agent_type: str = "software_engineer", plan_mode: bool = False) -> AgentTemplate:
    return await AgentTemplate.create({
        "name": name, "description": "d", "agent_type": agent_type,
        "system_prompt": "p", "model": model,
        "flags": json.dumps({}), "permissions_allow": json.dumps([]), "permissions_deny": json.dumps([]),
        "dangerously_skip_permissions": True, "plan_mode": plan_mode,
        "is_builtin": is_builtin, "project_id": None, "source_template_id": None,
    })


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
        await AgentTemplate.create({
            "name": "t283-override-a", "agent_type": "pm", "model": "claude-opus-4-8",
            "flags": json.dumps({}), "is_builtin": False,
            "project_id": PID, "source_template_id": g.id,
        })
        res = await self.get("/api/agent-templates")
        self.assertEqual(res.status_code, 200)
        names = self._names(res.json())
        self.assertIn("t283-global-a", names)
        self.assertNotIn("t283-override-a", names)

    # ── effective list resolution ─────────────────────────────────────────────

    async def test_effective_uses_override_when_present(self):
        g = await _make_global(name="t283-eff-base", model="claude-sonnet-4-6")
        override = await AgentTemplate.create({
            "name": "t283-eff-base", "agent_type": "software_engineer", "model": "claude-opus-4-8",
            "flags": json.dumps({}), "is_builtin": False,
            "project_id": PID, "source_template_id": g.id,
        })
        res = await self.get(f"/api/projects/{PID}/agent-templates")
        self.assertEqual(res.status_code, 200)
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
        res = await self.client.patch(
            f"/api/projects/{PID}/agent-templates/{g.id}", json={"model": "claude-opus-4-8"}
        )
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertNotEqual(body["id"], g.id)
        self.assertEqual(body["project_id"], PID)
        self.assertEqual(body["source_template_id"], g.id)
        self.assertFalse(body["is_builtin"])
        self.assertEqual(body["model"], "claude-opus-4-8")
        # the global itself is untouched
        fresh_global = await AgentTemplate.find(g.id)
        self.assertEqual(fresh_global.model, "claude-sonnet-4-6")

    async def test_edit_global_twice_updates_same_override(self):
        g = await _make_global(name="t283-cow2", model="claude-sonnet-4-6")
        first = await self.client.patch(
            f"/api/projects/{PID}/agent-templates/{g.id}", json={"model": "claude-opus-4-8"}
        )
        override_id = first.json()["id"]
        second = await self.client.patch(
            f"/api/projects/{PID}/agent-templates/{g.id}", json={"description": "tweaked"}
        )
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["id"], override_id)  # no second override created
        self.assertEqual(second.json()["description"], "tweaked")

    async def test_edit_existing_override_in_place(self):
        g = await _make_global(name="t283-cow3", model="claude-sonnet-4-6")
        override = await AgentTemplate.create({
            "name": "t283-cow3", "agent_type": "software_engineer", "model": "claude-opus-4-8",
            "flags": json.dumps({}), "is_builtin": False,
            "project_id": PID, "source_template_id": g.id,
        })
        res = await self.client.patch(
            f"/api/projects/{PID}/agent-templates/{override.id}", json={"model": "claude-haiku-4-5-20251001"}
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["id"], override.id)
        self.assertEqual(res.json()["model"], "claude-haiku-4-5-20251001")

    # ── project-only templates + delete + reset ───────────────────────────────

    async def test_project_store_creates_project_only_template(self):
        res = await self.client.post(
            f"/api/projects/{PID}/agent-templates", json={"name": "t283-proj-only", "agent_type": "qa"}
        )
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(body["project_id"], PID)
        self.assertIsNone(body["source_template_id"])
        eff = await self.get(f"/api/projects/{PID}/agent-templates")
        self.assertIn("t283-proj-only", self._names(eff.json()))

    async def test_project_destroy_reverts_to_global(self):
        g = await _make_global(name="t283-del", model="claude-sonnet-4-6")
        override = await AgentTemplate.create({
            "name": "t283-del", "agent_type": "software_engineer", "model": "claude-opus-4-8",
            "flags": json.dumps({}), "is_builtin": False,
            "project_id": PID, "source_template_id": g.id,
        })
        res = await self.client.delete(f"/api/projects/{PID}/agent-templates/{override.id}")
        self.assertEqual(res.status_code, 200)
        row = self._by_name((await self.get(f"/api/projects/{PID}/agent-templates")).json(), "t283-del")
        self.assertEqual(row["id"], g.id)  # back to the global
        self.assertFalse(row["is_override"])

    async def test_project_reset_removes_all_overrides(self):
        g = await _make_global(name="t283-reset", model="claude-sonnet-4-6")
        await AgentTemplate.create({
            "name": "t283-reset", "agent_type": "software_engineer", "model": "claude-opus-4-8",
            "flags": json.dumps({}), "is_builtin": False,
            "project_id": PID, "source_template_id": g.id,
        })
        await self.client.post(
            f"/api/projects/{PID}/agent-templates", json={"name": "t283-reset-extra", "agent_type": "qa"}
        )
        res = await self.client.post(f"/api/projects/{PID}/agent-templates/reset")
        self.assertEqual(res.status_code, 200)
        remaining = await AgentTemplate.where("project_id", PID).count()
        self.assertEqual(remaining, 0)
        names = self._names((await self.get(f"/api/projects/{PID}/agent-templates")).json())
        self.assertIn("t283-reset", names)          # global still resolved
        self.assertNotIn("t283-reset-extra", names)  # project-only template gone


class TestGlobalTemplateSync(TestCase, DatabaseTransaction):

    async def test_sync_overwrites_edited_global_builtin(self):
        # Start from a divergent built-in PM global, then sync from code defaults.
        await AgentTemplate.where("name", "PM").where_null("project_id").delete()
        await AgentTemplate.create({
            "name": "PM", "agent_type": "pm", "model": "claude-haiku-4-5-20251001",
            "system_prompt": "STALE", "flags": json.dumps({}),
            "dangerously_skip_permissions": True, "plan_mode": True,
            "is_builtin": True, "project_id": None, "source_template_id": None,
        })

        await SyncGlobalTemplatesAction().execute()

        pm = await AgentTemplate.where("name", "PM").where_null("project_id").first()
        self.assertEqual(pm.model, "claude-opus-4-8")  # code default
        self.assertFalse(bool(pm.plan_mode))           # PM is not a plan-mode role

    async def test_sync_leaves_project_overrides_untouched(self):
        override = await AgentTemplate.create({
            "name": "PM", "agent_type": "pm", "model": "claude-haiku-4-5-20251001",
            "flags": json.dumps({}), "is_builtin": False,
            "project_id": 779999, "source_template_id": None,
        })
        try:
            await SyncGlobalTemplatesAction().execute()
            fresh = await AgentTemplate.find(override.id)
            self.assertEqual(fresh.model, "claude-haiku-4-5-20251001")
            self.assertEqual(fresh.project_id, 779999)
        finally:
            await AgentTemplate.where("project_id", 779999).delete()
