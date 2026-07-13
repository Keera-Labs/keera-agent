import json

from fastapi_startkit.fastapi.testing import HttpTestCase

from app.controllers.global_settings_controller import write_global_setting
from app.models.Agent import Agent
from app.models.GlobalSettings import GlobalSettings
from app.models.Project import Project
from bootstrap.application import app


def _attrs(response) -> dict:
    """Extract the attributes of a single JSON:API agent resource document."""
    return response.json()["data"]["attributes"]


class TestAgents(HttpTestCase):
    def get_application(self):
        return app

    async def asyncSetUp(self):
        await super().asyncSetUp()
        await Agent.where("id", ">", 0).delete()
        await Project.where("id", ">", 0).delete()
        response = await self.post(
            "/api/projects",
            json={
                "name": "test-project",
                "path": "~/code/test-project",
                "language": "Python",
                "create_dir": True,
            },
        )
        self.project_id = response.json()["id"]

    # --- store ---

    async def test_store_creates_agent_with_defaults(self):
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "name": "My Agent",
                "complexity": "medium",
            },
        )
        self.assertEqual(response.status_code, 200)
        attrs = _attrs(response)
        self.assertEqual(attrs["name"], "My Agent")
        self.assertEqual(attrs["agent_type"], "software_engineer")
        self.assertTrue(attrs["dangerously_skip_permissions"])
        self.assertFalse(attrs["plan_mode"])

    async def test_store_pm_agent_defaults_plan_mode_off(self):
        # A PM must stay writable to coordinate the team — it is never forced
        # into plan mode by default.
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "name": "PM",
                "complexity": "medium",
                "agent_type": "pm",
            },
        )
        self.assertEqual(response.status_code, 200)
        attrs = _attrs(response)
        self.assertFalse(attrs["plan_mode"])
        self.assertTrue(attrs["dangerously_skip_permissions"])

    async def test_store_explicit_plan_mode_true(self):
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "name": "Planner",
                "complexity": "medium",
                "agent_type": "reviewer",
                "plan_mode": True,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(_attrs(response)["plan_mode"])

    async def test_store_nested_flags_plan_mode_promotes_to_column(self):
        # Legacy clients that nest plan_mode in flags still set the column.
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "name": "Legacy Plan",
                "complexity": "medium",
                "flags": {"plan_mode": True},
            },
        )
        self.assertEqual(response.status_code, 200)
        attrs = _attrs(response)
        self.assertTrue(attrs["plan_mode"])
        self.assertNotIn("plan_mode", json.loads(attrs["flags"]))

    async def test_store_explicit_plan_mode_false(self):
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "name": "PM No Plan",
                "complexity": "medium",
                "agent_type": "pm",
                "plan_mode": False,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(_attrs(response)["plan_mode"])

    async def test_store_explicit_dangerously_skip_permissions_false(self):
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "name": "Safe Agent",
                "complexity": "medium",
                "dangerously_skip_permissions": False,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(_attrs(response)["dangerously_skip_permissions"])

    async def test_store_requires_name(self):
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "agent_type": "software_engineer",
            },
        )
        self.assertEqual(response.status_code, 422)

    async def test_store_flags_excludes_promoted_columns(self):
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "name": "Flag Agent",
                "complexity": "medium",
                "flags": {"dangerously_skip_permissions": True, "plan_mode": True, "verbose": True},
            },
        )
        self.assertEqual(response.status_code, 200)
        # flags is stored (and serialized) as a raw JSON string
        flags = json.loads(_attrs(response)["flags"])
        # promoted fields should not bleed into flags
        self.assertNotIn("dangerously_skip_permissions", flags)
        self.assertNotIn("plan_mode", flags)
        self.assertTrue(flags.get("verbose"))

    # --- update ---

    async def _create_agent(self, **kwargs) -> dict:
        payload = {"name": "Agent", "complexity": "medium", **kwargs}
        resp = await self.post(f"/api/projects/{self.project_id}/agents", json=payload)
        return _attrs(resp)

    async def test_update_name(self):
        agent = await self._create_agent()
        response = await self.client.patch(f"/api/agents/{agent['id']}", json={"name": "Renamed"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(_attrs(response)["name"], "Renamed")

    async def test_update_dangerously_skip_permissions(self):
        agent = await self._create_agent()
        response = await self.client.patch(
            f"/api/agents/{agent['id']}", json={"dangerously_skip_permissions": False}
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(_attrs(response)["dangerously_skip_permissions"])

    async def test_update_plan_mode(self):
        agent = await self._create_agent()
        response = await self.client.patch(f"/api/agents/{agent['id']}", json={"plan_mode": True})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(_attrs(response)["plan_mode"])

    async def test_update_nested_flags_plan_mode_promotes_to_column(self):
        agent = await self._create_agent()
        response = await self.client.patch(
            f"/api/agents/{agent['id']}", json={"flags": {"plan_mode": True}}
        )
        self.assertEqual(response.status_code, 200)
        attrs = _attrs(response)
        self.assertTrue(attrs["plan_mode"])
        self.assertNotIn("plan_mode", json.loads(attrs["flags"]))

    async def test_update_omitted_fields_unchanged(self):
        # complexity=hard maps the created agent to claude-opus-4-8; a PATCH that
        # omits model must leave that resolved model untouched.
        agent = await self._create_agent(complexity="hard")
        response = await self.client.patch(f"/api/agents/{agent['id']}", json={"name": "New Name"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(_attrs(response)["model"], "claude-opus-4-8")

    async def test_update_nonexistent_agent_returns_404(self):
        response = await self.client.patch("/api/agents/999999", json={"name": "Ghost"})
        self.assertEqual(response.status_code, 404)

    # --- serialize ---

    async def test_serialize_exposes_permission_columns(self):
        agent = await self._create_agent()
        response = await self.get(f"/api/projects/{self.project_id}/agents")
        self.assertEqual(response.status_code, 200)
        found = next(a for a in response.json()["data"] if a["attributes"]["id"] == agent["id"])
        self.assertIn("dangerously_skip_permissions", found["attributes"])
        self.assertIn("plan_mode", found["attributes"])


class TestAgentTypeEnforcement(HttpTestCase):
    def get_application(self):
        return app

    async def asyncSetUp(self):
        await super().asyncSetUp()
        await Agent.where("id", ">", 0).delete()
        await Project.where("id", ">", 0).delete()
        response = await self.post(
            "/api/projects",
            json={
                "name": "test-project",
                "path": "~/code/test-project",
                "language": "Python",
                "create_dir": True,
            },
        )
        self.project_id = response.json()["id"]

    async def test_invalid_type_rejected(self):
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "name": "Bad Agent",
                "complexity": "medium",
                "agent_type": "hacker",
            },
        )
        self.assertEqual(response.status_code, 422)

    async def test_se_has_system_prompt(self):
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "name": "SE Agent",
                "complexity": "medium",
                "agent_type": "software_engineer",
            },
        )
        self.assertEqual(response.status_code, 200)
        system_prompt = _attrs(response)["system_prompt"]
        self.assertIsNotNone(system_prompt)
        self.assertGreater(len(system_prompt), 0)

    async def test_frontend_se_has_system_prompt(self):
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "name": "Frontend Agent",
                "complexity": "medium",
                "agent_type": "software_engineer_frontend",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("Frontend", _attrs(response)["system_prompt"])

    async def test_reviewer_has_system_prompt(self):
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "name": "Reviewer Agent",
                "complexity": "medium",
                "agent_type": "reviewer",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("Reviewer", _attrs(response)["system_prompt"])

    async def test_pm_defaults_plan_mode_off(self):
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "name": "PM Agent",
                "complexity": "medium",
                "agent_type": "pm",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(_attrs(response)["plan_mode"])

    async def test_se_has_dangerously_skip_true(self):
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "name": "SE Agent",
                "complexity": "medium",
                "agent_type": "software_engineer",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(_attrs(response)["dangerously_skip_permissions"])

    async def test_pm_agent_has_use_worktree_false(self):
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "name": "PM Agent",
                "complexity": "medium",
                "agent_type": "pm",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(_attrs(response)["use_worktree"])

    async def test_se_agent_has_use_worktree_true(self):
        response = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={
                "name": "SE Agent",
                "complexity": "medium",
                "agent_type": "software_engineer",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(_attrs(response)["use_worktree"])

    async def test_default_pm_agent_on_project_creation_has_use_worktree_false(self):
        # asyncSetUp already called POST /api/projects — PM agent is in the DB
        response = await self.get(f"/api/projects/{self.project_id}/agents")
        self.assertEqual(response.status_code, 200)
        agents = response.json()["data"]
        pm_agent = next(a for a in agents if a["attributes"]["agent_type"] == "pm")
        self.assertFalse(pm_agent["attributes"]["use_worktree"])
        # The auto-created PM must not be trapped in plan-only mode.
        self.assertFalse(pm_agent["attributes"]["plan_mode"])


class TestAgentLimit(HttpTestCase):
    """Tests for max_agents_per_project enforcement."""

    def get_application(self):
        return app

    async def asyncSetUp(self):
        await super().asyncSetUp()
        await Agent.where("id", ">", 0).delete()
        await Project.where("id", ">", 0).delete()
        await GlobalSettings.where("id", ">", 0).delete()
        response = await self.post(
            "/api/projects",
            json={
                "name": "limit-test-project",
                "path": "~/code/limit-test-project",
                "language": "Python",
                "create_dir": True,
            },
        )
        self.project_id = response.json()["id"]
        # Remove auto-created agents (e.g. default PM agent) so each test
        # starts with a clean 0-agent state and limit numbers are predictable.
        await Agent.where("project_id", self.project_id).delete()
        # Set a low limit for testing via the DB
        await write_global_setting("max_agents_per_project", 2)

    async def asyncTearDown(self):
        await GlobalSettings.where("id", ">", 0).delete()
        await super().asyncTearDown()

    async def test_create_agents_up_to_limit(self):
        """Should succeed creating agents up to the configured limit."""
        r1 = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={"name": "Agent 1", "complexity": "medium"},
        )
        self.assertEqual(r1.status_code, 200)

        r2 = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={"name": "Agent 2", "complexity": "medium"},
        )
        self.assertEqual(r2.status_code, 200)

    async def test_create_agent_beyond_limit_returns_422(self):
        """Creating an agent when the project is at the limit returns 422."""
        await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={"name": "Agent 1", "complexity": "medium"},
        )
        await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={"name": "Agent 2", "complexity": "medium"},
        )

        r3 = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={"name": "Agent 3", "complexity": "medium"},
        )
        self.assertEqual(r3.status_code, 422)
        body = r3.json()
        self.assertIn("error", body)
        self.assertIn("2", body["error"])  # limit number appears in the error

    async def test_deleted_agent_does_not_count_toward_limit(self):
        """Soft-deleted agents should not count against the limit."""
        r1 = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={"name": "Agent 1", "complexity": "medium"},
        )
        await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={"name": "Agent 2", "complexity": "medium"},
        )
        agent1_id = _attrs(r1)["id"]

        # Delete one agent
        await self.client.delete(f"/api/agents/{agent1_id}")

        # Now we should be able to create another agent
        r3 = await self.post(
            f"/api/projects/{self.project_id}/agents",
            json={"name": "Agent 3", "complexity": "medium"},
        )
        self.assertEqual(r3.status_code, 200)


class TestGlobalSettings(HttpTestCase):
    """Tests for the /api/global-settings endpoints."""

    def get_application(self):
        return app

    async def asyncSetUp(self):
        await super().asyncSetUp()
        await GlobalSettings.where("id", ">", 0).delete()

    async def asyncTearDown(self):
        await GlobalSettings.where("id", ">", 0).delete()
        await super().asyncTearDown()

    async def test_get_global_settings_returns_default_when_empty(self):
        """GET /api/global-settings returns the default (10) when no row exists."""
        response = await self.get("/api/global-settings")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("max_agents_per_project", data)
        self.assertEqual(data["max_agents_per_project"], 10)

    async def test_patch_global_settings_updates_value(self):
        """PATCH /api/global-settings persists the new value."""
        response = await self.client.patch(
            "/api/global-settings",
            json={"max_agents_per_project": 5},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["max_agents_per_project"], 5)

        # Confirm it is persisted
        get_resp = await self.get("/api/global-settings")
        self.assertEqual(get_resp.json()["max_agents_per_project"], 5)

    async def test_patch_invalid_max_agents_returns_422(self):
        """PATCH with max_agents_per_project < 1 returns 422."""
        response = await self.client.patch(
            "/api/global-settings",
            json={"max_agents_per_project": 0},
        )
        self.assertEqual(response.status_code, 422)

    async def test_patch_negative_max_agents_returns_422(self):
        """PATCH with negative max_agents_per_project returns 422."""
        response = await self.client.patch(
            "/api/global-settings",
            json={"max_agents_per_project": -1},
        )
        self.assertEqual(response.status_code, 422)
