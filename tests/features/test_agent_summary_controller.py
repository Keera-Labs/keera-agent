from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.AgentRelayMessage import AgentRelayMessage
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestAgentSummaryController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.other = await ProjectFactory.new().create()

    def _url(self, *project_ids: int) -> str:
        return "/api/agent-summaries?" + "&".join(f"project_ids={i}" for i in project_ids)

    async def _attributes_by_name(self, *project_ids: int) -> dict[str, dict]:
        response = await self.get(self._url(*project_ids))
        response.assert_ok()
        return {row["attributes"]["name"]: row["attributes"] for row in response.json()["data"]}

    async def test_index_returns_agents_of_every_requested_project(self):
        await AgentFactory.new().create(project_id=self.project.id, name="Alpha")
        await AgentFactory.new().create(project_id=self.other.id, name="Beta", provider="codex")
        unrelated = await ProjectFactory.new().create()
        await AgentFactory.new().create(project_id=unrelated.id, name="Gamma")

        rows = await self._attributes_by_name(self.project.id, self.other.id)

        self.assertEqual(set(rows), {"Alpha", "Beta"})
        self.assertEqual(rows["Alpha"]["project_id"], self.project.id)
        self.assertEqual(rows["Beta"]["provider"], "codex")
        self.assertEqual(rows["Alpha"]["status"], "idle")

    async def test_index_skips_soft_deleted_agents(self):
        await AgentFactory.new().create(
            project_id=self.project.id, name="Gone", deleted_at="2026-01-01 00:00:00"
        )

        rows = await self._attributes_by_name(self.project.id)

        self.assertNotIn("Gone", rows)

    async def test_preview_prefers_current_activity(self):
        agent = await AgentFactory.new().create(
            project_id=self.project.id,
            name="Busy",
            status="running",
            current_activity="Refactoring   the\nsidebar",
        )
        await AgentRelayMessage.create(
            {"from_agent_id": 0, "to_agent_id": agent.id, "content": "older instruction"}
        )

        rows = await self._attributes_by_name(self.project.id)

        self.assertEqual(rows["Busy"]["last_message"], "Refactoring the sidebar")

    async def test_preview_falls_back_to_latest_received_message(self):
        agent = await AgentFactory.new().create(project_id=self.project.id, name="Idle")
        for content in ("first", "second"):
            await AgentRelayMessage.create(
                {"from_agent_id": 0, "to_agent_id": agent.id, "content": content}
            )

        rows = await self._attributes_by_name(self.project.id)

        self.assertEqual(rows["Idle"]["last_message"], "second")
        self.assertIsNotNone(rows["Idle"]["last_activity_at"])

    async def test_preview_is_null_without_activity_or_messages(self):
        await AgentFactory.new().create(project_id=self.project.id, name="Quiet")

        rows = await self._attributes_by_name(self.project.id)

        self.assertIsNone(rows["Quiet"]["last_message"])

    async def test_last_activity_is_latest_timestamp_in_utc(self):
        await AgentFactory.new().create(
            project_id=self.project.id,
            name="Timed",
            updated_at="2026-01-01 10:00:00",
            started_at="2020-01-01 00:00:00",
        )

        rows = await self._attributes_by_name(self.project.id)

        self.assertEqual(rows["Timed"]["last_activity_at"], "2026-01-01T10:00:00+00:00")

    async def test_index_without_project_ids_returns_empty(self):
        response = await self.get("/api/agent-summaries")
        response.assert_ok()
        self.assertEqual(response.json()["data"], [])

    async def test_index_rejects_non_integer_project_ids(self):
        response = await self.get(
            "/api/agent-summaries?project_ids=abc", headers={"Accept": "application/json"}
        )
        response.assert_status(422)
