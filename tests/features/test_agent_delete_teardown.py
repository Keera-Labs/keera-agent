"""Deleting an agent must stop its terminal process and keep it from being respawned.

Uses a plain /bin/sh PTY running `sleep` as a stand-in for the agent CLI.
"""

import tempfile
import uuid
from unittest.mock import patch

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.agent_delete_action import AgentDeleteAction
from app.controllers.agent_trigger_controller import _spawn_headless_agent
from app.models.Agent import Agent
from app.services.claude_config_dir import agent_config_dir
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase
from tests.test_terminal_stop import _descendants, _is_running, _wait_until

SLEEP = "sleep 3021"


class TestAgentDeleteTeardown(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.cwd = tempfile.mkdtemp()
        self.project = await ProjectFactory.new().create(path=self.cwd)
        self.agent = await AgentFactory.new().create(project_id=self.project.id, use_worktree=False)
        self.terminals = app().make("terminal")

    async def _start_agent_process(self) -> tuple[str, int]:
        session_id = str(uuid.uuid4())
        self.terminals.create(shell="/bin/sh", cwd=self.cwd, session_id=session_id)
        self.addAsyncCleanup(self.terminals.close, session_id)
        terminal = self.terminals.get(session_id)
        await terminal.write(f"{SLEEP}\n".encode())

        def sleeper() -> list[int]:
            procs = _descendants(terminal.pid)
            return [pid for pid, cmd in procs.items() if cmd.strip() == SLEEP]

        self.assertTrue(_wait_until(lambda: bool(sleeper())), "dummy agent process never started")
        await Agent.where("id", self.agent.id).update({"session_id": session_id})
        return session_id, sleeper()[0]

    async def test_delete_kills_the_agent_process(self):
        session_id, pid = await self._start_agent_process()

        response = await self.client.delete(f"/api/agents/{self.agent.id}")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(_wait_until(lambda: not _is_running(pid), 3.0), "agent process survived")
        self.assertIsNone(self.terminals.find(session_id))
        agent = await Agent.find(self.agent.id)
        self.assertIsNotNone(agent.deleted_at)
        self.assertIsNone(agent.session_id)

    async def test_deleted_agent_is_not_respawned(self):
        await self.client.delete(f"/api/agents/{self.agent.id}")

        # Fail instead of opening a PTY, so a regression never launches a real CLI.
        with patch.object(self.terminals, "create", side_effect=AssertionError("respawned")):
            await _spawn_headless_agent(self.agent, self.project, self.cwd, "resume work")

        agent = await Agent.find(self.agent.id)
        self.assertIsNone(agent.session_id)


class TestDeleteRacingAgentWrites(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.cwd = tempfile.mkdtemp()
        self.project = await ProjectFactory.new().create(path=self.cwd)
        self.agent = await AgentFactory.new().create(
            project_id=self.project.id, use_worktree=False, status="running"
        )
        self.terminals = app().make("terminal")

    async def _delete(self, *_args, **_kwargs) -> None:
        await AgentDeleteAction(await Agent.find(self.agent.id), "racing").execute()

    async def _assert_still_deleted(self) -> None:
        agent = await Agent.find(self.agent.id)
        self.assertIsNotNone(agent.deleted_at)
        self.assertEqual(agent.status, "deleted")
        self.assertIsNone(agent.session_id)

    async def test_pause_racing_the_delete_leaves_the_agent_deleted(self):
        with patch(
            "app.controllers.agent_pause_controller.stop_agent_session", side_effect=self._delete
        ):
            response = await self.client.post(f"/api/projects/{self.project.id}/agents/pause")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn(self.agent.id, response.json()["paused"])
        await self._assert_still_deleted()

    async def test_gemini_failure_racing_the_delete_leaves_the_agent_deleted(self):
        async def delete_then_fail(*_args):
            await self._delete()
            raise RuntimeError("gemini cli missing")

        with patch(
            "app.controllers.agent_trigger_controller.asyncio.to_thread",
            side_effect=delete_then_fail,
        ):
            await _spawn_headless_agent(self.agent, self.project, self.cwd, "start")

        await self._assert_still_deleted()
        self.assertIsNone((await Agent.find(self.agent.id)).attention_kind)

    async def test_delete_during_spawn_setup_opens_no_terminal(self):
        real_config_dir = agent_config_dir

        async def delete_then_config_dir(agent, project):
            await self._delete()
            return await real_config_dir(agent, project)

        with (
            patch(
                "app.controllers.agent_trigger_controller.agent_config_dir",
                side_effect=delete_then_config_dir,
            ),
            patch.object(self.terminals, "create", side_effect=AssertionError("spawned")),
        ):
            await _spawn_headless_agent(self.agent, self.project, self.cwd, "start")

        await self._assert_still_deleted()
