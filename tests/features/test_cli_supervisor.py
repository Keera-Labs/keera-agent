"""An agent CLI that exits mid-session must be relaunched instead of leaving a bare shell.

The CLI is typed into an interactive shell, so when it exits the shell takes the
PTY back: the agent looked alive, and relay messages were typed in as shell
commands. A plain /bin/sh PTY stands in for the agent's terminal and `sleep`
for the CLI.
"""

import asyncio
import datetime
import os
import sys
import tempfile
import uuid
from unittest.mock import AsyncMock, patch

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Agent import Agent
from app.models.AgentRelayMessage import AgentRelayMessage
from app.terminal.cli_supervisor import (
    _EXIT_OSC,
    RESUME_NOTE,
    launch_cli,
    restart_cli,
    supervise_cli,
    with_exit_marker,
)
from app.terminal.readiness import claude_ready, is_cli_ready, mark_booting
from app.terminal.websocket_terminal import WebsocketTerminal
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


# Like the real CLIs it reads the keyboard in raw mode, so Ctrl-C reaches it as a
# byte and makes it exit.
_FAKE_CLI = """
import sys, termios, tty
old = termios.tcgetattr(0)
tty.setraw(0)
try:
    while sys.stdin.buffer.raw.read(1) not in (b"\\x03", b""):
        pass
finally:
    termios.tcsetattr(0, termios.TCSADRAIN, old)
"""


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

            async def gave_up():
                agent = await Agent.find(self.agent.id)
                return "keeps exiting" in (agent.current_activity or "")

            self.assertTrue(await _until(gave_up), "supervisor kept relaunching")
            await asyncio.sleep(0.5)

        self.assertEqual(len(self.launches), 1)
        self.assertFalse(is_cli_ready(self.session_id), "shell would receive relay messages")
        self.assertFalse(task.done(), "the restart button needs the supervisor to keep watching")

    def _use_fake_cli(self) -> str:
        script = os.path.join(self.cwd, "fake_cli.py")
        with open(script, "w") as f:
            f.write(_FAKE_CLI)
        command = f"{sys.executable} {script}"

        def build(agent) -> str:
            self.launches.append(agent.id)
            return command

        self._build_cmd = build
        return command

    async def _start_fake_cli(self) -> None:
        command = self._use_fake_cli()
        mark_booting(self.session_id).set()
        task = supervise_cli(self.agent.id, self.terminal, self.session_id, self._build_cmd)
        self.addAsyncCleanup(self._stop, task)
        await asyncio.sleep(0.2)
        await self.terminal.write(with_exit_marker(command).encode() + b"\n")
        await asyncio.sleep(1.0)

    async def test_restart_stops_the_running_cli_and_relaunches_it_supervised(self):
        await self._start_fake_cli()

        self.assertTrue(await restart_cli(self.session_id))
        self.assertEqual(self.launches, [self.agent.id])
        self.assertTrue(is_cli_ready(self.session_id))
        self.assertNotIn(RESUME_NOTE, self.sent)

        # Stopping the relaunched CLI needs its exit marker, so this proves it is supervised.
        await asyncio.sleep(1.0)
        self.assertTrue(await restart_cli(self.session_id))
        self.assertEqual(self.launches, [self.agent.id, self.agent.id])

    async def test_restart_relaunches_a_cli_that_already_exited(self):
        with patch("app.terminal.cli_supervisor.CliSupervisor.max_restarts", 0):
            await self._run_cli_that_exits()

            async def gave_up():
                agent = await Agent.find(self.agent.id)
                return "keeps exiting" in (agent.current_activity or "")

            self.assertTrue(await _until(gave_up))

        self.assertTrue(await restart_cli(self.session_id))
        self.assertEqual(self.launches, [self.agent.id])
        self.assertTrue(is_cli_ready(self.session_id))

    async def test_restart_never_relaunches_a_deleted_agent(self):
        await self._start_fake_cli()
        await Agent.where("id", self.agent.id).update({"deleted_at": datetime.datetime.utcnow()})

        self.assertFalse(await restart_cli(self.session_id))
        self.assertEqual(self.launches, [])

    async def test_launches_by_the_session_monitor_are_supervised(self):
        command = self._use_fake_cli()
        mark_booting(self.session_id)
        task = supervise_cli(self.agent.id, self.terminal, self.session_id, self._build_cmd)
        self.addAsyncCleanup(self._stop, task)
        await asyncio.sleep(0.2)
        # The first CLI exits while booting and the monitor relaunches it.
        await self.terminal.write(with_exit_marker("true").encode() + b"\n")
        await launch_cli(self.terminal, self.session_id, command)
        await asyncio.sleep(1.0)

        self.assertTrue(await restart_cli(self.session_id))
        self.assertEqual(self.launches, [self.agent.id])

    async def test_restart_button_message_reaches_the_supervisor(self):
        ws = AsyncMock()
        ws.receive = AsyncMock(
            side_effect=[
                {"type": "websocket.receive", "text": '{"type": "restart_cli"}'},
                {"type": "websocket.disconnect"},
            ]
        )
        on_restart = AsyncMock()
        self.terminal.write = AsyncMock()
        bridge = WebsocketTerminal(ws, self.terminal, on_restart=on_restart)

        await bridge._ws_to_pty()
        await asyncio.sleep(0)

        on_restart.assert_awaited_once()
        self.terminal.write.assert_not_awaited()

    def test_typed_launch_line_does_not_contain_the_exit_marker(self):
        # The shell echoes the typed line; only the printf running may produce the marker.
        self.assertNotIn(_EXIT_OSC, with_exit_marker("claude --continue").encode())
