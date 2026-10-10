import asyncio
import os
import tempfile
from unittest import mock

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.controllers import shell_controller
from app.terminal.manager import TerminalManager
from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.features.test_command_run_controller import ControllerWebSocket
from tests.test_case import TestCase
from tests.test_terminal_shared_pty import _until


class TestShellController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = GitTestRepo(self).init()
        self.repo.write("README.md", "hello\n")
        self.repo.commit_all("initial")
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))
        home = tempfile.TemporaryDirectory()
        self.addCleanup(home.cleanup)
        env = mock.patch.dict(
            os.environ, {"SHELL": "/bin/bash", "HOME": home.name, "VIRTUAL_ENV": "/keera/.venv"}
        )
        env.start()
        self.addCleanup(env.stop)
        self.sockets: list[tuple[ControllerWebSocket, asyncio.Task]] = []

    async def asyncTearDown(self):
        for ws, task in self.sockets:
            ws.disconnect()
            await asyncio.wait_for(task, 10)
        await super().asyncTearDown()

    def _attach(self, worktree: str | None = None, slug: str | None = None):
        ws = ControllerWebSocket()
        task = asyncio.create_task(shell_controller.attach(ws, slug or self.project.slug, worktree))
        self.sockets.append((ws, task))
        return ws, task

    def _shell_sessions(self) -> list[str]:
        terminals: TerminalManager = app().make("terminal")
        return [sid for sid in terminals._sessions if sid.startswith("shell:")]

    async def _output_of(self, ws: ControllerWebSocket, script: str, marker: str) -> str:
        ws.type(f"{script}\r")
        self.assertTrue(
            await _until(lambda: marker in ws.received.decode(errors="replace"), 10),
            ws.received.decode(errors="replace"),
        )
        return ws.received.decode(errors="replace")

    async def test_opens_a_shell_in_the_project_root(self):
        ws, _ = self._attach()

        await self._output_of(ws, 'echo "cwd=$(pwd -P)"', f"cwd={self.repo.root}\r")

    async def test_opens_a_shell_in_the_requested_worktree(self):
        worktree = self.repo.add_worktree(".claude/worktrees/agent-7", "agent-work")
        ws, _ = self._attach(str(worktree))

        await self._output_of(ws, 'echo "cwd=$(pwd -P)"', f"cwd={worktree}\r")

    async def test_removing_a_worktree_closes_the_shells_open_in_it(self):
        worktree = self.repo.add_worktree("../doomed", "doomed-work")
        _, doomed = self._attach(str(worktree))
        _, kept = self._attach()
        self.assertTrue(await _until(lambda: len(self._shell_sessions()) == 2, 10))

        response = await self.delete(
            f"/api/projects/{self.project.id}/git/worktrees", params={"worktree": str(worktree)}
        )

        response.assert_no_content()
        self.assertTrue(await _until(doomed.done, 10))
        self.assertEqual(len(self._shell_sessions()), 1)
        self.assertFalse(kept.done())

    async def test_runs_the_user_shell_as_a_login_shell(self):
        ws, _ = self._attach()

        await self._output_of(ws, "shopt -q login_shell && echo is-$((6*7))-login", "is-42-login")

    async def test_hides_the_keera_virtualenv_from_the_shell(self):
        ws, _ = self._attach()

        output = await self._output_of(ws, 'echo "venv=[$VIRTUAL_ENV]"', "venv=[]")

        self.assertNotIn("venv=[/keera/.venv]", output)

    async def test_disconnecting_kills_the_shell(self):
        ws, task = self._attach()
        await self._output_of(ws, "echo ready-$((1+1))", "ready-2")
        self.assertEqual(len(self._shell_sessions()), 1)

        ws.disconnect()
        await asyncio.wait_for(task, 10)

        self.assertEqual(self._shell_sessions(), [])

    async def test_exiting_the_shell_closes_the_socket(self):
        ws, task = self._attach()
        await self._output_of(ws, "echo ready-$((1+1))", "ready-2")

        ws.type("exit\r")
        await asyncio.wait_for(task, 10)

        self.assertEqual(ws.closed_with, 1000)
        self.assertEqual(self._shell_sessions(), [])

    async def test_refuses_an_unknown_worktree(self):
        ws, task = self._attach(str(self.repo.base / "nowhere"))
        await asyncio.wait_for(task, 5)

        self.assertEqual(ws.closed_with, 1008)
        self.assertEqual(self._shell_sessions(), [])

    async def test_refuses_an_unknown_project(self):
        ws, task = self._attach(slug="no-such-project")
        await asyncio.wait_for(task, 5)

        self.assertEqual(ws.closed_with, 1008)
