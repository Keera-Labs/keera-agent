import datetime

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.AgentRelayMessage import AgentRelayMessage
from app.models.Workspace import Workspace
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestDashboardPage(TestCase, DatabaseTransaction):
    """GET / renders the Dashboard as a first-class Inertia page (static snapshot).

    The dashboard payload is nested under ``props.dashboard`` so it never
    collides with the flat ``projects`` sidebar list the persistent AppLayout
    reads. Per-project assertions target a uniquely named project so they never
    collide with data other tests committed through the HTTP app.
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

        card = next(p for p in dashboard["projects"] if p["name"] == "Root Snapshot Proj")
        # slug is exposed so the frontend can link each card to /{slug}.
        self.assertEqual(card["slug"], project.slug)

        working = [w for w in dashboard["workingNow"] if w["project"] == "Root Snapshot Proj"]
        self.assertEqual(len(working), 1)
        self.assertEqual(working[0]["name"], "Root Builder")
        self.assertEqual(working[0]["role"], "Software Engineer")

    async def test_project_card_buckets_agents_by_state(self):
        """Per-project counts cover _build_dashboard's active/waiting/queued/done
        bucketing, including the relay-pending → queued signal."""
        workspace = await Workspace.create({"name": "Buckets WS"})
        project = await ProjectFactory.new().create(workspace_id=workspace.id, name="Buckets Proj")

        running = await self._agent(project.id, name="Runner", status="running")
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

        response = await self.get("/", headers=self._INERTIA)
        response.assert_ok()
        dashboard = response.json()["props"]["dashboard"]

        card = next(p for p in dashboard["projects"] if p["name"] == "Buckets Proj")
        self.assertEqual(card["activeCount"], 1)
        self.assertEqual(card["waitingCount"], 1)
        self.assertEqual(card["queuedCount"], 1)  # idle agent with a pending relay message
        self.assertEqual(card["doneCount"], 1)
        self.assertTrue(card["online"])
