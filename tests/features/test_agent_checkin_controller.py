import json
from unittest.mock import patch

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.controllers import agent_checkin_controller
from app.models.Agent import Agent
from app.requests.agent_checkin_request import AgentCheckinRequest
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


def _body(resource) -> dict:
    return json.loads(bytes(resource.body))


class TestAgentCheckinController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.pm = await AgentFactory.new().create(
            project_id=self.project.id, agent_type="pm"
        )

    async def test_show_returns_default_state(self):
        with patch.object(agent_checkin_controller.checkin_scheduler, "is_running", return_value=False):
            resp = await agent_checkin_controller.show(self.pm.id)

        data = _body(resp)
        self.assertFalse(data["enabled"])
        self.assertEqual(data["interval_minutes"], 5)
        self.assertFalse(data["running"])

    async def test_update_enables_persists_and_starts_scheduler(self):
        with patch.object(agent_checkin_controller.checkin_scheduler, "start") as start, \
             patch.object(agent_checkin_controller.checkin_scheduler, "is_running", return_value=True):
            resp = await agent_checkin_controller.update(
                AgentCheckinRequest(enabled=True, interval_minutes=3), self.pm.id
            )

        start.assert_called_once_with(self.project.id, 3)
        data = _body(resp)
        self.assertTrue(data["enabled"])
        self.assertEqual(data["interval_minutes"], 3)
        self.assertTrue(data["running"])

        pm = await Agent.find(self.pm.id)
        self.assertTrue(bool(pm.checkin_enabled))
        self.assertEqual(int(pm.checkin_interval_minutes), 3)

    async def test_update_disable_stops_scheduler(self):
        with patch.object(agent_checkin_controller.checkin_scheduler, "stop") as stop, \
             patch.object(agent_checkin_controller.checkin_scheduler, "is_running", return_value=False):
            resp = await agent_checkin_controller.update(
                AgentCheckinRequest(enabled=False, interval_minutes=5), self.pm.id
            )

        stop.assert_called_once_with(self.project.id)
        data = _body(resp)
        self.assertFalse(data["enabled"])
        self.assertFalse(data["running"])
