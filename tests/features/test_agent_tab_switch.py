import asyncio
import os
import re
import signal
import stat
import subprocess
import tempfile

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction
from starlette.websockets import WebSocketState

from app.controllers.terminal_controller import terminal_ws
from app.models.Agent import Agent
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

TAB_SWITCHES = 20

FAKE_CLI = """#!/bin/sh
timeout 45 sleep 120 &
echo "child=$!"
wait
"""


class TabWebSocket:
    def __init__(self):
        self.inbox: asyncio.Queue = asyncio.Queue()
        self.client_state = WebSocketState.CONNECTING

    async def accept(self) -> None:
        self.client_state = WebSocketState.CONNECTED

    async def receive(self) -> dict:
        return await self.inbox.get()

    async def send_bytes(self, data: bytes) -> None:
        pass

    async def send_text(self, data: str) -> None:
        pass

    async def close(self, *args, **kwargs) -> None:
        self.disconnect()

    def disconnect(self) -> None:
        self.client_state = WebSocketState.DISCONNECTED
        self.inbox.put_nowait({"type": "websocket.disconnect"})


async def _until(predicate, timeout: float = 10.0) -> bool:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate():
            return True
        await asyncio.sleep(0.02)
    return predicate()


def _git(cwd: str, *args: str) -> None:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "Test",
        "GIT_AUTHOR_EMAIL": "test@example.com",
        "GIT_COMMITTER_NAME": "Test",
        "GIT_COMMITTER_EMAIL": "test@example.com",
    }
    subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True, check=True)


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


class TestAgentTabSwitch(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = tempfile.mkdtemp()
        _git(self.repo, "init", "-b", "main")
        _git(self.repo, "commit", "--allow-empty", "-m", "initial")
        self.project = await ProjectFactory.new().create(path=self.repo, is_repository=True)
        self.agent = await AgentFactory.new().create(project_id=self.project.id)
        self._install_fake_cli()
        self.terminals = app().make("terminal")
        self.tabs: list[tuple[TabWebSocket, asyncio.Task]] = []
        self.child: int | None = None

    async def asyncTearDown(self):
        session_id = (await Agent.find(self.agent.id)).session_id
        if session_id:
            await self.terminals.close(session_id)
        for ws, _ in self.tabs:
            ws.disconnect()
        await asyncio.gather(*(task for _, task in self.tabs), return_exceptions=True)
        if self.child and _pid_alive(self.child):
            os.kill(self.child, signal.SIGKILL)
        os.environ.clear()
        os.environ.update(self.saved_env)
        await super().asyncTearDown()

    def _install_fake_cli(self) -> None:
        bin_dir = tempfile.mkdtemp()
        cli = os.path.join(bin_dir, "claude")
        with open(cli, "w") as f:
            f.write(FAKE_CLI)
        os.chmod(cli, os.stat(cli).st_mode | stat.S_IEXEC)
        self.saved_env = dict(os.environ)
        os.environ["SHELL"] = "/bin/sh"
        os.environ["PATH"] = f"{bin_dir}{os.pathsep}{os.environ['PATH']}"

    def open_tab(self) -> TabWebSocket:
        ws = TabWebSocket()
        task = asyncio.create_task(terminal_ws(ws, self.project.slug, agent_id=self.agent.id))
        self.tabs.append((ws, task))
        return ws

    async def leave_tab(self, ws: TabWebSocket) -> None:
        ws.disconnect()
        task = next(task for tab, task in self.tabs if tab is ws)
        await asyncio.wait_for(task, timeout=10)

    async def live_terminal(self):
        for _ in range(500):
            session_id = (await Agent.find(self.agent.id)).session_id
            terminal = self.terminals.find(session_id) if session_id else None
            if terminal and terminal.is_alive():
                return terminal
            await asyncio.sleep(0.02)
        self.fail("the agent never got a live terminal")

    async def start_agent(self):
        first = self.open_tab()
        terminal = await self.live_terminal()
        self.assertTrue(await _until(lambda: b"child=" in terminal.history()))
        self.child = int(re.search(rb"child=(\d+)", terminal.history()).group(1))
        return first, terminal

    async def test_switching_tabs_never_kills_the_running_agent_process(self):
        tab, terminal = await self.start_agent()
        shell = terminal.pid
        session_id = (await Agent.find(self.agent.id)).session_id

        for _ in range(TAB_SWITCHES):
            await self.leave_tab(tab)
            tab = self.open_tab()
            await asyncio.sleep(0.05)

        await asyncio.sleep(0.5)
        self.assertTrue(_pid_alive(self.child))
        self.assertTrue(terminal.is_alive())
        self.assertEqual(terminal.pid, shell)
        self.assertIs(self.terminals.find(session_id), terminal)
        self.assertEqual((await Agent.find(self.agent.id)).session_id, session_id)

    async def test_overlapping_tab_switches_reuse_one_process(self):
        tab, terminal = await self.start_agent()
        session_id = (await Agent.find(self.agent.id)).session_id

        for _ in range(TAB_SWITCHES):
            previous, tab = tab, self.open_tab()
            await asyncio.sleep(0.01)
            await self.leave_tab(previous)

        await asyncio.sleep(0.5)
        self.assertTrue(_pid_alive(self.child))
        self.assertIs(self.terminals.find(session_id), terminal)
        self.assertIsNotNone(app().make("connections").get(session_id))

    async def test_only_deleting_the_agent_kills_its_process_tree(self):
        tab, terminal = await self.start_agent()
        await self.leave_tab(tab)
        self.open_tab()

        response = await self.delete(f"/api/agents/{self.agent.id}")

        response.assert_status(200)
        self.assertTrue(await _until(lambda: not _pid_alive(self.child)))
        self.assertFalse(terminal.is_alive())
