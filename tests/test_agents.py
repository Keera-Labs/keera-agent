import json

from bootstrap.application import app
from fastapi_startkit.fastapi.testing import HttpTestCase
from app.models.Agent import Agent
from app.models.Project import Project


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
        response = await self.post("/api/projects", json={
            "name": "test-project",
            "path": "~/code/test-project",
            "language": "Python",
            "create_dir": True,
        })
        self.project_id = response.json()["id"]

    # --- store ---

    async def test_store_creates_agent_with_defaults(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "name": "My Agent",
        })
        self.assertEqual(response.status_code, 200)
        attrs = _attrs(response)
        self.assertEqual(attrs["name"], "My Agent")
        self.assertEqual(attrs["agent_type"], "software_engineer")
        self.assertTrue(attrs["dangerously_skip_permissions"])
        self.assertFalse(attrs["plan_mode"])

    async def test_store_pm_agent_enables_plan_mode(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "name": "PM",
            "agent_type": "pm",
        })
        self.assertEqual(response.status_code, 200)
        attrs = _attrs(response)
        self.assertTrue(attrs["plan_mode"])
        self.assertTrue(attrs["dangerously_skip_permissions"])

    async def test_store_explicit_plan_mode_false(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "name": "PM No Plan",
            "agent_type": "pm",
            "plan_mode": False,
        })
        self.assertEqual(response.status_code, 200)
        self.assertFalse(_attrs(response)["plan_mode"])

    async def test_store_explicit_dangerously_skip_permissions_false(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "name": "Safe Agent",
            "dangerously_skip_permissions": False,
        })
        self.assertEqual(response.status_code, 200)
        self.assertFalse(_attrs(response)["dangerously_skip_permissions"])

    async def test_store_requires_name(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "agent_type": "software_engineer",
        })
        self.assertEqual(response.status_code, 422)

    async def test_store_flags_excludes_promoted_columns(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "name": "Flag Agent",
            "flags": {"dangerously_skip_permissions": True, "plan_mode": True, "verbose": True},
        })
        self.assertEqual(response.status_code, 200)
        # flags is stored (and serialized) as a raw JSON string
        flags = json.loads(_attrs(response)["flags"])
        # promoted fields should not bleed into flags
        self.assertNotIn("dangerously_skip_permissions", flags)
        self.assertNotIn("plan_mode", flags)
        self.assertTrue(flags.get("verbose"))

    # --- update ---

    async def _create_agent(self, **kwargs) -> dict:
        resp = await self.post(f"/api/projects/{self.project_id}/agents", json={"name": "Agent", **kwargs})
        return _attrs(resp)

    async def test_update_name(self):
        agent = await self._create_agent()
        response = await self.client.patch(f"/api/agents/{agent['id']}", json={"name": "Renamed"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(_attrs(response)["name"], "Renamed")

    async def test_update_dangerously_skip_permissions(self):
        agent = await self._create_agent()
        response = await self.client.patch(f"/api/agents/{agent['id']}", json={"dangerously_skip_permissions": False})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(_attrs(response)["dangerously_skip_permissions"])

    async def test_update_plan_mode(self):
        agent = await self._create_agent()
        response = await self.client.patch(f"/api/agents/{agent['id']}", json={"plan_mode": True})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(_attrs(response)["plan_mode"])

    async def test_update_omitted_fields_unchanged(self):
        agent = await self._create_agent(model="claude-opus-4-5")
        response = await self.client.patch(f"/api/agents/{agent['id']}", json={"name": "New Name"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(_attrs(response)["model"], "claude-opus-4-5")

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
        response = await self.post("/api/projects", json={
            "name": "test-project",
            "path": "~/code/test-project",
            "language": "Python",
            "create_dir": True,
        })
        self.project_id = response.json()["id"]

    async def test_invalid_type_rejected(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "name": "Bad Agent",
            "agent_type": "hacker",
        })
        self.assertEqual(response.status_code, 422)

    async def test_se_has_system_prompt(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "name": "SE Agent",
            "agent_type": "software_engineer",
        })
        self.assertEqual(response.status_code, 200)
        system_prompt = _attrs(response)["system_prompt"]
        self.assertIsNotNone(system_prompt)
        self.assertGreater(len(system_prompt), 0)

    async def test_frontend_se_has_system_prompt(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "name": "Frontend Agent",
            "agent_type": "software_engineer_frontend",
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn("Frontend", _attrs(response)["system_prompt"])

    async def test_reviewer_has_system_prompt(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "name": "Reviewer Agent",
            "agent_type": "reviewer",
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn("Reviewer", _attrs(response)["system_prompt"])

    async def test_pm_has_plan_mode_true(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "name": "PM Agent",
            "agent_type": "pm",
        })
        self.assertEqual(response.status_code, 200)
        self.assertTrue(_attrs(response)["plan_mode"])

    async def test_se_has_dangerously_skip_true(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "name": "SE Agent",
            "agent_type": "software_engineer",
        })
        self.assertEqual(response.status_code, 200)
        self.assertTrue(_attrs(response)["dangerously_skip_permissions"])
