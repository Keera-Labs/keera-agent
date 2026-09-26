"""An agent CLI that exits mid-session must be relaunched instead of leaving a bare shell.

The CLI is typed into an interactive shell, so when it exits the shell takes the
PTY back: the agent looked alive, and relay messages were typed in as shell
commands. A plain /bin/sh PTY stands in for the agent's terminal and `sleep`
for the CLI.
"""

import asyncio
import datetime
import tempfile
import uuid
from unittest.mock import AsyncMock, patch

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Agent import Agent
from app.models.AgentRelayMessage import AgentRelayMessage
from app.terminal.cli_supervisor import _EXIT_OSC, RESUME_NOTE, supervise_cli, with_exit_marker
from app.terminal.readiness import claude_ready, is_cli_ready, mark_booting
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


async def _until(predicate, timeout: float = 5.0) -> bool:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        if await predicate():
            return True
        await asyncio.sleep(0.05)
    return await predicate()


class TestCliSupervisor(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.cwd = tempfile.mkdtemp()
        self.project = await ProjectFactory.new().create(path=self.cwd)
        self.agent = await AgentFactory.new().create(project_id=self.project.id, use_worktree=False)
        self.sender = await AgentFactory.new().create(
            project_id=self.project.id, use_worktree=False
        )
        self.terminals = app().make("terminal")

        self.session_id = str(uuid.uuid4())
        self.terminals.create(shell="/bin/sh", cwd=self.cwd, session_id=self.session_id)
        self.addAsyncCleanup(self.terminals.close, self.session_id)
        self.addCleanup(claude_ready.pop, self.session_id, None)
        self.terminal = self.terminals.get(self.session_id)
        await Agent.where("id", self.agent.id).update({"session_id": self.session_id})

        self.terminal.wait_for_cli_ready = AsyncMock(return_value=True)
        self.sent: list[str] = []
        self.terminal.send = AsyncMock(side_effect=self.sent.append)
        self.launches: list[int] = []

    def _build_cmd(self, agent) -> str:
        self.launches.append(agent.id)
        return "sleep 30"

    async def _run_cli_that_exits(self, ready: bool = True) -> asyncio.Task:
        event = mark_booting(self.session_id)
        if ready:
            event.set()
        task = supervise_cli(self.agent.id, self.terminal, self.session_id, self._build_cmd)
        self.addAsyncCleanup(self._stop, task)
        await asyncio.sleep(0.2)
        await self.terminal.write(with_exit_marker("sleep 0.2").encode() + b"\n")
        return task

    @staticmethod
    async def _stop(task: asyncio.Task) -> None:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    async def test_relaunches_the_cli_and_resumes_its_task(self):
        await self._run_cli_that_exits()

        async def resumed():
            return RESUME_NOTE in self.sent

        self.assertTrue(await _until(resumed), "CLI was not relaunched")
        self.assertEqual(self.launches, [self.agent.id])
        self.assertTrue(is_cli_ready(self.session_id))

    async def test_messages_sent_while_the_cli_is_down_wait_for_the_relaunch(self):
        release = asyncio.Event()

        async def slow_boot(*args, **kwargs):
            await release.wait()
            return True

        self.terminal.wait_for_cli_ready = AsyncMock(side_effect=slow_boot)
        await self._run_cli_that_exits()

        async def relaunching():
            return bool(self.launches)

        self.assertTrue(await _until(relaunching))
        self.assertFalse(is_cli_ready(self.session_id), "shell would receive relay messages")

        msg = await AgentRelayMessage.create(
            {
                "from_agent_id": self.sender.id,
                "to_agent_id": self.agent.id,
                "content": "status?",
                "status": "pending",
            }
        )
        release.set()

        async def delivered():
            return (await AgentRelayMessage.find(msg.id)).status == "delivered"

        self.assertTrue(await _until(delivered))
        self.assertEqual(self.sent[0], RESUME_NOTE)
        self.assertIn("status?", self.sent[1])

    async def test_exit_while_booting_is_left_to_the_session_monitor(self):
        await self._run_cli_that_exits(ready=False)
        await asyncio.sleep(1.0)

        self.assertEqual(self.launches, [])

    async def test_deleted_agent_is_not_relaunched(self):
        await Agent.where("id", self.agent.id).update({"deleted_at": datetime.datetime.utcnow()})

        task = await self._run_cli_that_exits()

        async def stopped():
            return task.done()

        self.assertTrue(await _until(stopped))
        self.assertEqual(self.launches, [])
        self.assertFalse(is_cli_ready(self.session_id))

    async def test_gives_up_when_the_cli_keeps_exiting(self):
        with patch("app.terminal.cli_supervisor.CliSupervisor.max_restarts", 1):
            self._build_cmd = lambda agent: self.launches.append(agent.id) or "sleep 0.2"
            task = await self._run_cli_that_exits()

            async def stopped():
                return task.done()

            self.assertTrue(await _until(stopped), "supervisor kept relaunching")

        self.assertEqual(len(self.launches), 1)
        self.assertFalse(is_cli_ready(self.session_id), "shell would receive relay messages")
        agent = await Agent.find(self.agent.id)
        self.assertIn("keeps exiting", agent.current_activity)

    def test_typed_launch_line_does_not_contain_the_exit_marker(self):
        # The shell echoes the typed line; only the printf running may produce the marker.
        self.assertNotIn(_EXIT_OSC, with_exit_marker("claude --continue").encode())
