from unittest.mock import AsyncMock, patch

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app import checkin_scheduler
from app.models.Agent import Agent
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from databases.factories.task_factory import TaskFactory
from tests.test_case import TestCase


class TestCheckinScheduler(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.pm = await AgentFactory.new().create(
            project_id=self.project.id, agent_type="pm", checkin_enabled=True
        )

    async def asyncTearDown(self):
        checkin_scheduler.stop(self.project.id)
        await super().asyncTearDown()

    async def test_tick_pings_pm_when_task_in_progress(self):
        await TaskFactory.new().create(project_id=self.project.id, status="in_progress")

        with patch.object(
            checkin_scheduler, "_send_checkin", new_callable=AsyncMock
        ) as send:
            cont = await checkin_scheduler._tick(self.project.id)

        self.assertTrue(cont)
        send.assert_awaited_once_with(self.project.id)

    async def test_tick_stops_and_disables_when_no_in_progress_task(self):
        await TaskFactory.new().create(project_id=self.project.id, status="completed")

        with patch.object(
            checkin_scheduler, "_send_checkin", new_callable=AsyncMock
        ) as send:
            cont = await checkin_scheduler._tick(self.project.id)

        self.assertFalse(cont)
        send.assert_not_awaited()

        pm = await Agent.find(self.pm.id)
        self.assertFalse(bool(pm.checkin_enabled))

    async def test_start_is_idempotent(self):
        first = checkin_scheduler.start(self.project.id, 5)
        second = checkin_scheduler.start(self.project.id, 5)

        self.assertIs(first, second)
        self.assertTrue(checkin_scheduler.is_running(self.project.id))

    async def test_stop_halts_the_loop(self):
        checkin_scheduler.start(self.project.id, 5)
        self.assertTrue(checkin_scheduler.is_running(self.project.id))

        stopped = checkin_scheduler.stop(self.project.id)

        self.assertTrue(stopped)
        self.assertFalse(checkin_scheduler.is_running(self.project.id))
