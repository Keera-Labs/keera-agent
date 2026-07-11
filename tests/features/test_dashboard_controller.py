import datetime

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.AgentRelayMessage import AgentRelayMessage
from app.models.Workspace import Workspace
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestDashboardController(TestCase, DatabaseTransaction):
    """GET /api/dashboard aggregates real agent/project activity.

    Data is seeded through factories/models (rolled back per test) and read back
    over HTTP. Workspace-scoped assertions use a freshly created workspace id so
    they never collide with data other tests committed through the HTTP app.
    """

    async def _agent(self, project_id: int, **overrides):
        return await AgentFactory.new().create(project_id=project_id, **overrides)

    async def test_aggregates_workspace_states(self):
        workspace = await Workspace.create({"name": "Acme Workspace"})
        project = await ProjectFactory.new().create(workspace_id=workspace.id, name="Acme App")

        started = (datetime.datetime.now() - datetime.timedelta(minutes=3)).isoformat(
            sep=" ", timespec="seconds"
        )
        running = await self._agent(
            project.id,
            name="Builder",
            agent_type="software_engineer",
            status="running",
            started_at=started,
            current_activity="Refactoring the auth module",
        )
        await self._agent(project.id, name="Waiter", status="waiting")
        await self._agent(project.id, name="Idle One", status="idle")
        queued = await self._agent(project.id, name="Queued One", status="idle")
        await AgentRelayMessage.create(
            {
                "from_agent_id": running.id,
                "to_agent_id": queued.id,
                "content": "please start",
                "status": "pending",
            }
        )

        response = await self.get(f"/api/dashboard?workspace_id={workspace.id}")
        response.assert_ok()
        body = response.json()

        self.assertEqual(body["workspaceName"], "Acme Workspace")
        self.assertEqual(body["projectCount"], 1)
        self.assertEqual(body["agentCount"], 4)
        self.assertEqual(body["stats"], {"projects": 1, "active": 1, "waiting": 1, "queued": 1})

        self.assertEqual(len(body["workingNow"]), 1)
        card = body["workingNow"][0]
        self.assertEqual(card["name"], "Builder")
        self.assertEqual(card["project"], "Acme App")
        self.assertEqual(card["role"], "Software Engineer")
        self.assertEqual(card["description"], "Refactoring the auth module")
        self.assertTrue(card["elapsed"])  # elapsed timer is a non-empty string

        self.assertEqual(len(body["projects"]), 1)
        project_card = body["projects"][0]
        self.assertEqual(project_card["name"], "Acme App")
        self.assertEqual(project_card["activeCount"], 1)
        self.assertEqual(project_card["waitingCount"], 1)
        self.assertEqual(project_card["queuedCount"], 1)
        self.assertEqual(project_card["doneCount"], 1)
        self.assertTrue(project_card["online"])

    async def test_scopes_to_requested_workspace(self):
        workspace_a = await Workspace.create({"name": "WS A"})
        workspace_b = await Workspace.create({"name": "WS B"})
        project_a = await ProjectFactory.new().create(workspace_id=workspace_a.id, name="Only A")
        project_b = await ProjectFactory.new().create(workspace_id=workspace_b.id, name="Only B")
        await self._agent(project_a.id, name="A agent")
        await self._agent(project_b.id, name="B agent")

        response = await self.get(f"/api/dashboard?workspace_id={workspace_a.id}")
        response.assert_ok()
        names = [p["name"] for p in response.json()["projects"]]

        self.assertIn("Only A", names)
        self.assertNotIn("Only B", names)

    async def test_without_workspace_id_includes_all_projects(self):
        workspace = await Workspace.create({"name": "Global WS"})
        project = await ProjectFactory.new().create(workspace_id=workspace.id, name="Global Proj")
        await self._agent(project.id, name="Someone")

        response = await self.get("/api/dashboard")
        response.assert_ok()
        body = response.json()

        self.assertEqual(body["workspaceName"], "All Projects")
        self.assertIn("Global Proj", [p["name"] for p in body["projects"]])


class TestDashboardPage(TestCase, DatabaseTransaction):
    """GET / renders the Dashboard as a first-class Inertia page (static snapshot).

    The dashboard payload is nested under ``props.dashboard`` so it never
    collides with the flat ``projects`` sidebar list the persistent AppLayout
    reads. Aggregation reuses the same logic as GET /api/dashboard.
    """

    _INERTIA = {"X-Inertia": "true", "X-Inertia-Version": ""}

    async def _agent(self, project_id: int, **overrides):
        return await AgentFactory.new().create(project_id=project_id, **overrides)

    async def test_root_renders_dashboard_with_nested_payload(self):
        response = await self.get("/", headers=self._INERTIA)
        response.assert_ok()
        body = response.json()

        self.assertEqual(body["component"], "Dashboard")
        props = body["props"]

        # Layout/sidebar props stay at the top level for AppLayout.
        for key in ("projects", "workspaces", "global_settings"):
            self.assertIn(key, props)

        # Dashboard payload is always present (even with no data) and nested.
        self.assertIn("dashboard", props)
        dashboard = props["dashboard"]
        self.assertEqual(dashboard["workspaceName"], "All Projects")
        self.assertEqual(
            set(dashboard["stats"].keys()), {"projects", "active", "waiting", "queued"}
        )
        self.assertIsInstance(dashboard["workingNow"], list)
        self.assertIsInstance(dashboard["projects"], list)

    async def test_dashboard_payload_reflects_active_agent(self):
        workspace = await Workspace.create({"name": "Root WS"})
        project = await ProjectFactory.new().create(
            workspace_id=workspace.id, name="Root Snapshot Proj"
        )
        started = (datetime.datetime.now() - datetime.timedelta(minutes=2)).isoformat(
            sep=" ", timespec="seconds"
        )
        await self._agent(
            project.id,
            name="Root Builder",
            agent_type="software_engineer",
            status="running",
            started_at=started,
            current_activity="Wiring the root page",
        )

        response = await self.get("/", headers=self._INERTIA)
        response.assert_ok()
        dashboard = response.json()["props"]["dashboard"]

        self.assertIn("Root Snapshot Proj", [p["name"] for p in dashboard["projects"]])
        working = [w for w in dashboard["workingNow"] if w["project"] == "Root Snapshot Proj"]
        self.assertEqual(len(working), 1)
        self.assertEqual(working[0]["name"], "Root Builder")
        self.assertEqual(working[0]["role"], "Software Engineer")
