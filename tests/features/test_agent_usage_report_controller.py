import time

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.AgentUsageReport import AgentUsageReport
from databases.factories.agent_factory import AgentFactory
from databases.factories.agent_usage_report_factory import AgentUsageReportFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestAgentUsageReportController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        # A path with no transcripts, so the usage endpoint only reflects reports.
        self.project = await ProjectFactory.new().create(path="/nonexistent/keera-usage-test")
        self.agent = await AgentFactory.new().create(project_id=self.project.id)

    async def _payload(self, **overrides) -> dict:
        report = await AgentUsageReportFactory.new().make()
        return {**report.serialize(), "agent_id": self.agent.id, **overrides}

    async def test_store_keeps_one_latest_report_per_agent(self):
        first = await self.post("/api/agent-usage-reports", json=await self._payload())
        first.assert_ok()
        second = await self.post(
            "/api/agent-usage-reports",
            json=await self._payload(five_hour_used_percentage=64.0, context_used_percentage=52.5),
        )
        second.assert_ok()

        reports = await AgentUsageReport.where("agent_id", self.agent.id).get()
        self.assertEqual(len(reports), 1)
        self.assertEqual(reports.first().five_hour_used_percentage, 64.0)
        attributes = second.json()["data"]["attributes"]
        self.assertEqual(attributes["five_hour"]["used_percentage"], 64.0)
        self.assertEqual(attributes["context_used_percentage"], 52.5)

    async def test_store_accepts_a_report_without_rate_limits(self):
        response = await self.post(
            "/api/agent-usage-reports",
            json={"agent_id": self.agent.id, "context_used_percentage": 3},
        )

        response.assert_ok()
        attributes = response.json()["data"]["attributes"]
        self.assertIsNone(attributes["five_hour"])
        self.assertIsNone(attributes["seven_day"])

    async def test_store_rejects_an_unknown_agent(self):
        response = await self.post(
            "/api/agent-usage-reports", json=await self._payload(agent_id=999999)
        )

        response.assert_status(404)

    async def test_store_validates_percentages(self):
        response = await self.post(
            "/api/agent-usage-reports", json=await self._payload(context_used_percentage=150)
        )

        response.assert_status(422)

    async def test_project_usage_includes_reports_and_the_latest_limits(self):
        other = await AgentFactory.new().create(project_id=self.project.id)
        await AgentUsageReportFactory.new().create(
            agent_id=self.agent.id, five_hour_used_percentage=10.0, updated_at="2026-01-01 00:00:00"
        )
        await AgentUsageReportFactory.new().create(
            agent_id=other.id, five_hour_used_percentage=30.0, context_used_percentage=70.0
        )

        response = await self.get(f"/api/projects/{self.project.id}/usage")

        response.assert_ok()
        attributes = response.json()["data"]["attributes"]
        self.assertEqual(attributes["limits"]["five_hour"]["used_percentage"], 30.0)
        self.assertEqual(attributes["reports"][str(other.id)]["context_used_percentage"], 70.0)
        self.assertEqual(set(attributes["reports"]), {str(self.agent.id), str(other.id)})

    async def test_windows_that_already_reset_are_dropped(self):
        await AgentUsageReportFactory.new().create(
            agent_id=self.agent.id, five_hour_resets_at=int(time.time()) - 60
        )

        response = await self.get(f"/api/projects/{self.project.id}/usage")

        limits = response.json()["data"]["attributes"]["limits"]
        self.assertIsNone(limits["five_hour"])
        self.assertEqual(limits["seven_day"]["used_percentage"], 41.2)
