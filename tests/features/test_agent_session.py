import asyncio
import os
import re
import subprocess
import tempfile
import uuid

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Agent import Agent
from app.terminal.agent_session import attach_client, own_session
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class FakeWebSocket:
    def __init__(self):
        self.inbox: asyncio.Queue = asyncio.Queue()
        self.received = b""

    async def receive(self) -> dict:
        return await self.inbox.get()

    async def send_bytes(self, data: bytes) -> None:
        self.received += data

    async def send_text(self, data: str) -> None:
        pass

    async def close(self, *args, **kwargs) -> None:
        self.disconnect()

    def disconnect(self) -> None:
        self.inbox.put_nowait({"type": "websocket.disconnect"})


async def _until(predicate, timeout: float = 5.0) -> bool:
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


class TestAgentSession(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = tempfile.mkdtemp()
        _git(self.repo, "init", "-b", "main")
        _git(self.repo, "commit", "--allow-empty", "-m", "initial")
        self.project = await ProjectFactory.new().create(path=self.repo)
        self.agent = await AgentFactory.new().create(project_id=self.project.id)
        self.worktree = os.path.join(self.repo, ".claude", "worktrees", f"agent-{self.agent.id}")
        _git(self.repo, "worktree", "add", "-b", f"worktree-agent-{self.agent.id}", self.worktree)

        self.session_id = str(uuid.uuid4())
        await Agent.where("id", self.agent.id).update({"session_id": self.session_id})
        self.terminals = app().make("terminal")
        self.terminals.create(shell="/bin/sh", cwd=self.worktree, session_id=self.session_id)
        self.terminal = self.terminals.get(self.session_id)
        self.owner = own_session(self.agent.id, self.session_id, self.terminal)
        self.clients: list[asyncio.Task] = []
        self.sockets: list[FakeWebSocket] = []

    async def asyncTearDown(self):
        await self.terminals.close(self.session_id)
        for ws in self.sockets:
            ws.disconnect()
        await asyncio.gather(self.owner, *self.clients, return_exceptions=True)
        await super().asyncTearDown()

    def attach(self) -> FakeWebSocket:
        ws = FakeWebSocket()
        self.sockets.append(ws)
        self.clients.append(
            asyncio.create_task(attach_client(ws, self.session_id, self.terminal, self.repo))
        )
        return ws

    async def detach(self, ws: FakeWebSocket) -> None:
        ws.disconnect()
        await asyncio.wait_for(self.clients[-1], timeout=5)

    async def test_a_client_disconnect_keeps_the_process_running(self):
        pid = self.terminal.pid
        await self.detach(self.attach())
        await asyncio.sleep(0.3)

        self.assertTrue(self.terminal.is_alive())
        self.assertIs(self.terminals.find(self.session_id), self.terminal)
        self.assertEqual(self.terminal.pid, pid)
        self.assertFalse(self.owner.done())

    async def test_output_while_detached_is_kept_and_replayed_on_reattach(self):
        await self.detach(self.attach())

        await self.terminal.write(b"echo detached-$((40+2))\n")
        self.assertTrue(await _until(lambda: b"detached-42" in self.terminal.history()))

        reattached = self.attach()
        self.assertTrue(await _until(lambda: b"detached-42" in reattached.received))

    async def test_a_reconnect_replaces_the_registered_client_without_losing_it(self):
        connections = app().make("connections")
        first = self.attach()
        await _until(lambda: connections.get(self.session_id) is not None)
        self.attach()
        await _until(lambda: connections.get(self.session_id).websocket is not first)

        first.disconnect()
        await asyncio.wait_for(self.clients[0], timeout=5)

        self.assertIsNotNone(connections.get(self.session_id))

    async def test_the_session_is_released_once_the_process_exits(self):
        await self.terminal.write(b"exit\n")
        await asyncio.wait_for(self.owner, timeout=5)

        self.assertIsNone(self.terminals.find(self.session_id))
        self.assertIsNone((await Agent.find(self.agent.id)).session_id)

    async def test_deleting_the_agent_kills_its_process_tree_and_removes_its_worktree(self):
        self.attach()
        await self.terminal.write(b"sleep 300 & echo child=$!\n")
        self.assertTrue(await _until(lambda: b"child=" in self.terminal.history()))
        child = int(re.search(rb"child=(\d+)", self.terminal.history()).group(1))
        shell = self.terminal.pid

        response = await self.delete(f"/api/agents/{self.agent.id}")

        response.assert_status(200)
        await asyncio.wait_for(self.owner, timeout=5)
        self.assertTrue(await _until(lambda: not _pid_alive(child)))
        self.assertFalse(_pid_alive(shell))
        self.assertIsNone(self.terminals.find(self.session_id))
        self.assertFalse(os.path.exists(self.worktree))
        self.assertIsNotNone((await Agent.find(self.agent.id)).deleted_at)
