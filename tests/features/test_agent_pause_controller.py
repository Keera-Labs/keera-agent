"""Pausing a project must stop every active agent's terminal and mark it idle.

Uses a plain /bin/sh PTY as a stand-in for the agent CLI.
"""

import tempfile
import uuid

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Agent import Agent
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestAgentPauseController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.cwd = tempfile.mkdtemp()
        self.project = await ProjectFactory.new().create(path=self.cwd)
        self.terminals = app().make("terminal")

    @property
    def pause_url(self) -> str:
        return f"/api/projects/{self.project.id}/agents/pause"

    async def _agent_with_terminal(self, status: str) -> tuple[Agent, str]:
        session_id = str(uuid.uuid4())
        self.terminals.create(shell="/bin/sh", cwd=self.cwd, session_id=session_id)
        self.addAsyncCleanup(self.terminals.close, session_id)
        agent = await AgentFactory.new().create(
            project_id=self.project.id,
            use_worktree=False,
            status=status,
            session_id=session_id,
            has_session=True,
        )
        return agent, session_id

    async def test_pauses_running_and_waiting_for_input_agents(self):
        running, running_session = await self._agent_with_terminal("running")
        asking, asking_session = await self._agent_with_terminal("needs_input")

        response = await self.post(self.pause_url)

        response.assert_ok()
        self.assertCountEqual(response.json()["paused"], [running.id, asking.id])
        for agent, session_id in ((running, running_session), (asking, asking_session)):
            self.assertIsNone(self.terminals.find(session_id))
            paused = await Agent.find(agent.id)
            self.assertEqual(paused.status, "idle")
            self.assertIsNone(paused.session_id)
            self.assertTrue(paused.has_session)

    async def test_leaves_idle_deleted_and_other_projects_agents_alone(self):
        idle, idle_session = await self._agent_with_terminal("waiting")
        other_project = await ProjectFactory.new().create()
        other = await AgentFactory.new().create(project_id=other_project.id, status="running")

        response = await self.post(self.pause_url)

        self.assertEqual(response.json()["paused"], [])
        self.assertIsNotNone(self.terminals.find(idle_session))
        self.assertEqual((await Agent.find(idle.id)).status, "waiting")
        self.assertEqual((await Agent.find(other.id)).status, "running")

    async def test_skips_soft_deleted_agents(self):
        agent = await AgentFactory.new().create(
            project_id=self.project.id, status="running", deleted_at="2026-09-01 00:00:00"
        )

        response = await self.post(self.pause_url)

        self.assertEqual(response.json()["paused"], [])
        self.assertEqual((await Agent.find(agent.id)).status, "running")
