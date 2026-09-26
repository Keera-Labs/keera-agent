"""Deleting the PM: it runs in the main checkout, orchestrates other agents, and is
the target of the heartbeat and check-in schedulers."""

import datetime
import tempfile
from unittest.mock import patch

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app import checkin_scheduler, heartbeat
from app.actions.agent_message_send_action import AgentMessageSendAction
from app.models.Agent import Agent
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from databases.factories.task_factory import TaskFactory
from tests.test_case import TestCase


class TestPmDelete(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create(path=tempfile.mkdtemp())
        self.pm = await AgentFactory.new().create(
            project_id=self.project.id, agent_type="pm", use_worktree=False
        )
        await TaskFactory.new().create(project_id=self.project.id, status="in_progress")

    async def test_delete_pm_keeps_its_orchestrated_agents(self):
        worker = await AgentFactory.new().create(
            project_id=self.project.id, orchestrator_id=self.pm.id
        )

        response = await self.client.delete(f"/api/agents/{self.pm.id}")

        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone((await Agent.find(self.pm.id)).deleted_at)
        self.assertIsNone((await Agent.find(worker.id)).deleted_at)

    async def test_deleted_pm_gets_no_checkin_or_heartbeat(self):
        await Agent.where("id", self.pm.id).update(
            {"deleted_at": datetime.datetime.now(datetime.UTC)}
        )

        with patch.object(AgentMessageSendAction, "prepare") as prepare:
            await checkin_scheduler._send_checkin(self.project.id)
            await heartbeat.send_heartbeat(self.project.id)

        prepare.assert_not_called()
