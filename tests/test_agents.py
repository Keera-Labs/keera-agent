from bootstrap.application import app
from fastapi_startkit.fastapi.testing import HttpTestCase
from app.models.Agent import Agent
from app.models.Project import Project


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
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["name"], "My Agent")
        self.assertEqual(data["agent_type"], "custom")
        self.assertTrue(data["dangerously_skip_permissions"])
        self.assertFalse(data["plan_mode"])

    async def test_store_pm_agent_enables_plan_mode(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "name": "PM",
            "agent_type": "pm",
        })
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertTrue(data["plan_mode"])
        self.assertTrue(data["dangerously_skip_permissions"])

    async def test_store_explicit_plan_mode_false(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "name": "PM No Plan",
            "agent_type": "pm",
            "plan_mode": False,
        })
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()["plan_mode"])

    async def test_store_explicit_dangerously_skip_permissions_false(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "name": "Safe Agent",
            "dangerously_skip_permissions": False,
        })
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()["dangerously_skip_permissions"])

    async def test_store_requires_name(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "agent_type": "custom",
        })
        self.assertEqual(response.status_code, 422)

    async def test_store_flags_excludes_promoted_columns(self):
        response = await self.post(f"/api/projects/{self.project_id}/agents", json={
            "name": "Flag Agent",
            "flags": {"dangerously_skip_permissions": True, "plan_mode": True, "verbose": True},
        })
        self.assertEqual(response.status_code, 201)
        data = response.json()
        # promoted fields should not bleed into flags
        self.assertNotIn("dangerously_skip_permissions", data["flags"])
        self.assertNotIn("plan_mode", data["flags"])
        self.assertTrue(data["flags"].get("verbose"))

    # --- update ---

    async def _create_agent(self, **kwargs) -> dict:
        resp = await self.post(f"/api/projects/{self.project_id}/agents", json={"name": "Agent", **kwargs})
        return resp.json()

    async def test_update_name(self):
        agent = await self._create_agent()
        response = await self.client.patch(f"/api/agents/{agent['id']}", json={"name": "Renamed"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["name"], "Renamed")

    async def test_update_dangerously_skip_permissions(self):
        agent = await self._create_agent()
        response = await self.client.patch(f"/api/agents/{agent['id']}", json={"dangerously_skip_permissions": False})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["dangerously_skip_permissions"])

    async def test_update_plan_mode(self):
        agent = await self._create_agent()
        response = await self.client.patch(f"/api/agents/{agent['id']}", json={"plan_mode": True})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["plan_mode"])

    async def test_update_omitted_fields_unchanged(self):
        agent = await self._create_agent(model="claude-opus-4-5")
        response = await self.client.patch(f"/api/agents/{agent['id']}", json={"name": "New Name"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["model"], "claude-opus-4-5")

    async def test_update_nonexistent_agent_returns_404(self):
        response = await self.client.patch("/api/agents/999999", json={"name": "Ghost"})
        self.assertEqual(response.status_code, 404)

    # --- serialize ---

    async def test_serialize_exposes_permission_columns(self):
        agent = await self._create_agent()
        response = await self.get(f"/api/projects/{self.project_id}/agents")
        self.assertEqual(response.status_code, 200)
        found = next(a for a in response.json() if a["id"] == agent["id"])
        self.assertIn("dangerously_skip_permissions", found)
        self.assertIn("plan_mode", found)
