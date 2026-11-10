import asyncio
import json
import tempfile
from unittest.mock import AsyncMock, patch

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.agent_delete_action import AgentDeleteAction
from app.actions.agent_message_send_action import AgentMessageSendAction
from app.actions.agent_status_action import live_agent
from app.actions.task_transition_action import StaleTaskWriteError
from app.mcp.tools import DeleteAgentTool
from app.models.Agent import Agent
from app.models.AgentRelayMessage import AgentRelayMessage
from app.models.Task import Task
from app.models.TaskEvent import TaskEvent
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from databases.factories.task_factory import TaskFactory
from tests.test_case import TestCase


def _spawn_patch():
    return patch("app.controllers.agent_trigger_controller._spawn_headless_agent", new=AsyncMock())


def _failing_close_agent():
    return patch.object(
        app().make("terminal"), "close_agent", side_effect=RuntimeError("pty stuck")
    )


def _failing_requeue():
    return patch(
        "app.actions.agent_delete_action.write_task",
        side_effect=StaleTaskWriteError("task kept changing"),
    )


def _failing_relay_send():
    return patch.object(AgentMessageSendAction, "execute", side_effect=RuntimeError("relay down"))


class TestAgentDeleteResumesAfterFailure(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create(path=tempfile.mkdtemp())
        self.pm = await AgentFactory.new().create(
            project_id=self.project.id, agent_type="pm", use_worktree=False
        )
        self.task = await TaskFactory.new().create(
            project_id=self.project.id, status="acked", branch=None
        )
        self.agent = await AgentFactory.new().create(
            project_id=self.project.id,
            task_id=self.task.id,
            orchestrator_id=self.pm.id,
            worktree_branch="task/half-done",
            use_worktree=False,
        )
        await Task.where("id", self.task.id).update({"assignees": json.dumps([self.agent.name])})

    async def _fail_first_delete(self, failure) -> None:
        with failure, _spawn_patch(), self.assertRaises(Exception):
            await AgentDeleteAction(await Agent.find(self.agent.id), "stuck").execute()

    async def _reports(self) -> list[str]:
        rows = await AgentRelayMessage.where("to_agent_id", self.pm.id).get()
        return [r.content for r in rows if r.from_agent_id == self.agent.id]

    async def _assert_teardown_completed_once(self) -> None:
        task = await Task.find(self.task.id)
        self.assertEqual(task.status, "created")
        self.assertEqual(task.assignees, [])
        self.assertEqual(await TaskEvent.where("task_id", self.task.id).count(), 1)
        [report] = await self._reports()
        self.assertIn(f"agent deleted: {self.agent.name} (stuck)", report)
        self.assertIn(f"task #{self.task.id} is now created", report)
        agent = await Agent.find(self.agent.id)
        self.assertEqual(agent.deleted_reason, "stuck")
        self.assertEqual(agent.status, "deleted")
        self.assertIsNone(agent.task_id)
        self.assertIsNone(await live_agent(self.agent.id).first())

    async def test_ui_delete_finishes_after_the_pty_close_failed(self):
        await self._fail_first_delete(_failing_close_agent())
        self.assertEqual(await TaskEvent.where("task_id", self.task.id).count(), 0)

        with _spawn_patch():
            response = await self.client.delete(f"/api/agents/{self.agent.id}")

        self.assertEqual(response.status_code, 200)
        await self._assert_teardown_completed_once()

    async def test_mcp_delete_finishes_after_the_requeue_failed(self):
        await self._fail_first_delete(_failing_requeue())
        self.assertEqual((await Task.find(self.task.id)).status, "acked")
        self.assertEqual(await self._reports(), [])

        with _spawn_patch():
            response = await DeleteAgentTool().handle(
                {"agent_id": self.agent.id, "reason": "again"}
            )

        self.assertIn("has been deleted", response.to_content()[0]["text"])
        await self._assert_teardown_completed_once()

    async def test_retry_sends_the_report_without_requeueing_again(self):
        await self._fail_first_delete(_failing_relay_send())
        self.assertEqual(await TaskEvent.where("task_id", self.task.id).count(), 1)
        self.assertEqual(await self._reports(), [])

        with _spawn_patch():
            await AgentDeleteAction(await Agent.find(self.agent.id), "again").execute()

        await self._assert_teardown_completed_once()

    async def test_concurrent_retries_finish_the_teardown_once(self):
        await self._fail_first_delete(_failing_requeue())
        loaded = await Agent.find(self.agent.id)

        with _spawn_patch():
            results = await asyncio.gather(
                *(AgentDeleteAction(loaded, f"retry {n}").execute() for n in range(3))
            )

        self.assertEqual(results, [True, True, True])
        await self._assert_teardown_completed_once()

    async def test_finished_teardown_is_not_repeated_over_mcp(self):
        with _spawn_patch():
            await DeleteAgentTool().handle({"agent_id": self.agent.id, "reason": "stuck"})
            response = await DeleteAgentTool().handle({"agent_id": self.agent.id})

        self.assertIn("already been deleted", response.to_content()[0]["text"])
        await self._assert_teardown_completed_once()
