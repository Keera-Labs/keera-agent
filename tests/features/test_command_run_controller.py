import asyncio
import os
import re
import shutil
import tempfile
from pathlib import Path

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction
from starlette.websockets import WebSocketState

from app.controllers import command_run_controller
from app.models.Command import Command
from app.terminal.command_runs import CommandRun, CommandRunRegistry, command_shell
from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase
from tests.test_terminal_shared_pty import FakeWebSocket, _until


class ControllerWebSocket(FakeWebSocket):
    def __init__(self):
        super().__init__()
        self.client_state = WebSocketState.CONNECTING
        self.closed_with: int | None = None

    async def accept(self) -> None:
        self.client_state = WebSocketState.CONNECTED

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self.client_state = WebSocketState.DISCONNECTED
        self.closed_with = code
        self.disconnect()


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


class TestCommandRunController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = GitTestRepo(self).init()
        self.repo.write("README.md", "hello\n")
        self.repo.commit_all("initial")
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))
        self.registry: CommandRunRegistry = app().make("command_runs")
        self.commands: list[Command] = []

    async def asyncTearDown(self):
        for command in self.commands:
            await self.registry.forget_command(command.id)
        await super().asyncTearDown()

    async def _command(self, script: str, project=None) -> Command:
        command = await Command.create(
            {"project_id": (project or self.project).id, "label": "cmd", "command": script}
        )
        self.commands.append(command)
        return command

    async def _start(self, command: Command, worktree: str | None = None):
        body = {"worktree": worktree} if worktree else {}
        return await self.post(f"/api/commands/{command.id}/runs", json=body)

    def _run(self, command: Command, cwd: Path) -> CommandRun:
        run = self.registry.find(command.id, str(cwd))
        self.assertIsNotNone(run)
        return run

    async def _finished_output(self, run: CommandRun) -> str:
        self.assertTrue(await _until(lambda: run.exit_code is not None))
        return run.terminal.history().decode(errors="replace")

    async def test_runs_in_the_project_root(self):
        command = await self._command("pwd")

        response = await self._start(command)

        response.assert_ok()
        attributes = response.json()["data"]["attributes"]
        self.assertIsNone(attributes["worktree"])
        run = self._run(command, self.repo.root)
        self.assertIn(str(self.repo.root), await self._finished_output(run))
        self.assertEqual(run.exit_code, 0)

    async def test_expands_a_home_relative_project_path(self):
        home_dir = Path(tempfile.mkdtemp(dir=Path.home(), prefix=".keera-command-test-"))
        self.addCleanup(shutil.rmtree, home_dir, True)
        project = await ProjectFactory.new().create(path=f"~/{home_dir.name}")
        command = await self._command("pwd", project)

        (await self._start(command)).assert_ok()

        run = self._run(command, home_dir.resolve())
        self.assertIn(str(home_dir.resolve()), await self._finished_output(run))

    async def test_runs_in_the_requested_worktree_with_keera_env(self):
        worktree = self.repo.add_worktree(".claude/worktrees/agent-7", "agent-work")
        command = await self._command(
            'pwd; echo "root=$KEERA_PROJECT_ROOT wt=$KEERA_WORKTREE agent=$KEERA_AGENT_ID"'
        )

        response = await self._start(command, str(worktree))

        self.assertEqual(response.json()["data"]["attributes"]["worktree"], str(worktree))
        output = await self._finished_output(self._run(command, worktree))
        self.assertIn(str(worktree), output.splitlines()[0])
        self.assertIn(f"root={self.repo.root} wt={worktree} agent=7", output)

    async def test_a_root_run_gets_no_agent_id(self):
        command = await self._command('echo "agent=[$KEERA_AGENT_ID]"')

        (await self._start(command)).assert_ok()

        self.assertIn("agent=[]", await self._finished_output(self._run(command, self.repo.root)))

    async def test_rejects_worktrees_git_does_not_list(self):
        prunable = self.repo.add_worktree("../gone", "gone")
        shutil.rmtree(prunable)
        command = await self._command("pwd")

        for worktree in (str(self.repo.base / "nowhere"), "../gone", str(prunable)):
            with self.subTest(worktree=worktree):
                (await self._start(command, worktree)).assert_status(422)

        self.assertEqual(self.registry.for_commands([command.id]), [])

    async def test_root_and_worktree_runs_coexist(self):
        worktree = self.repo.add_worktree(".claude/worktrees/agent-3", "agent-three")
        command = await self._command("sleep 30")

        (await self._start(command)).assert_ok()
        (await self._start(command, str(worktree))).assert_ok()

        response = await self.get(f"/api/projects/{self.project.id}/command-runs")
        response.assert_ok()
        runs = {
            item["attributes"]["worktree"]: item["attributes"] for item in response.json()["data"]
        }
        self.assertEqual(set(runs), {None, str(worktree)})
        self.assertTrue(all(run["status"] == "running" for run in runs.values()))

    async def test_index_reports_the_run_of_the_viewed_worktree(self):
        worktree = self.repo.add_worktree(".claude/worktrees/agent-4", "agent-four")
        command = await self._command("sleep 30")
        (await self._start(command, str(worktree))).assert_ok()

        in_worktree = await self.get(
            f"/api/projects/{self.project.id}/commands", params={"worktree": str(worktree)}
        )
        in_root = await self.get(f"/api/projects/{self.project.id}/commands")

        self.assertEqual(in_worktree.json()["data"][0]["attributes"]["run"]["status"], "running")
        self.assertIsNone(in_root.json()["data"][0]["attributes"]["run"])

    async def test_starting_a_running_command_restarts_it(self):
        command = await self._command("sleep 30")
        (await self._start(command)).assert_ok()
        first_pid = self._run(command, self.repo.root).terminal.pid

        (await self._start(command)).assert_ok()

        second = self._run(command, self.repo.root)
        self.assertNotEqual(second.terminal.pid, first_pid)
        self.assertEqual(second.status, "running")
        self.assertTrue(await _until(lambda: not _alive(first_pid)))

    async def test_concurrent_restarts_leave_exactly_one_live_process(self):
        command = await self._command("sleep 30")
        (await self._start(command)).assert_ok()
        first_pid = self._run(command, self.repo.root).terminal.pid
        env = dict(os.environ)
        cwd = str(self.repo.root)

        async def restart() -> int:
            run = await self.registry.start(command.id, command.command, cwd, env)
            return run.terminal.pid

        pids = await asyncio.gather(restart(), restart())

        current = self._run(command, self.repo.root)
        self.assertIn(current.terminal.pid, pids)
        self.assertTrue(await _until(lambda: not _alive(first_pid)))
        self.assertTrue(
            await _until(lambda: [pid for pid in pids if _alive(pid)] == [current.terminal.pid])
        )

    async def test_restarting_replaces_the_previous_exited_run(self):
        command = await self._command("exit 0")
        (await self._start(command)).assert_ok()
        first = self._run(command, self.repo.root)
        await self._finished_output(first)

        (await self._start(command)).assert_ok()

        self.assertIsNot(self._run(command, self.repo.root), first)
        self.assertEqual(len(self.registry.for_commands([command.id])), 1)

    async def test_finished_runs_of_removed_worktrees_are_dropped(self):
        worktree = self.repo.add_worktree(".claude/worktrees/agent-5", "agent-five")
        command = await self._command("exit 0")
        (await self._start(command, str(worktree))).assert_ok()
        await self._finished_output(self._run(command, worktree))

        shutil.rmtree(worktree)

        self.assertEqual(self.registry.for_commands([command.id]), [])

    async def test_runs_through_a_posix_login_shell_only(self):
        self.assertEqual(command_shell("/bin/zsh"), "/bin/zsh")
        self.assertEqual(command_shell("/usr/local/bin/bash"), "/usr/local/bin/bash")
        self.assertEqual(command_shell("/opt/homebrew/bin/fish"), "/bin/sh")
        self.assertEqual(command_shell("/usr/bin/nu"), "/bin/sh")
        self.assertEqual(command_shell(None), "/bin/sh")

    async def test_a_non_posix_user_shell_falls_back_to_sh(self):
        command = await self._command('echo "shell=$0"')
        env = {**os.environ, "SHELL": "/opt/homebrew/bin/fish"}

        run = await self.registry.start(command.id, command.command, str(self.repo.root), env)

        self.assertIn("shell=/bin/sh", await self._finished_output(run))

    async def test_stop_kills_the_child_process_group(self):
        command = await self._command('sleep 30 & echo "child=$!"; wait')
        (await self._start(command)).assert_ok()
        run = self._run(command, self.repo.root)
        self.assertTrue(await _until(lambda: b"child=" in run.terminal.history()))
        child = int(re.search(rb"child=(\d+)", run.terminal.history()).group(1))

        response = await self.delete(f"/api/commands/{command.id}/runs")

        response.assert_no_content()
        self.assertTrue(await _until(lambda: not _alive(child)))
        self.assertEqual(run.status, "stopped")

    async def test_records_the_exit_code_of_a_natural_exit(self):
        command = await self._command("exit 3")

        (await self._start(command)).assert_ok()

        run = self._run(command, self.repo.root)
        await self._finished_output(run)
        self.assertEqual(run.exit_code, 3)
        self.assertEqual(run.status, "exited")

    async def test_deleting_the_command_stops_its_runs(self):
        command = await self._command("sleep 30")
        (await self._start(command)).assert_ok()
        pid = self._run(command, self.repo.root).terminal.pid

        (await self.delete(f"/api/commands/{command.id}")).assert_no_content()

        self.assertIsNone(self.registry.find(command.id, str(self.repo.root)))
        self.assertTrue(await _until(lambda: not _alive(pid)))

    async def _attach(self, command: Command, worktree: str | None = None):
        ws = ControllerWebSocket()
        task = asyncio.create_task(
            command_run_controller.attach(ws, self.project.slug, command.id, worktree)
        )
        return ws, task

    async def test_websocket_disconnect_keeps_the_process_and_reconnect_replays(self):
        command = await self._command("echo hello-replay; sleep 30")
        (await self._start(command)).assert_ok()
        run = self._run(command, self.repo.root)
        self.assertTrue(await _until(lambda: b"hello-replay" in run.terminal.history()))

        first, first_task = await self._attach(command)
        self.assertTrue(await _until(lambda: b"hello-replay" in first.received))
        first.disconnect()
        await asyncio.wait_for(first_task, 5)

        self.assertTrue(run.terminal.is_alive())
        second, second_task = await self._attach(command)
        self.assertTrue(await _until(lambda: b"hello-replay" in second.received))
        second.disconnect()
        await asyncio.wait_for(second_task, 5)
        self.assertTrue(run.terminal.is_alive())

    async def test_websocket_streams_input_to_the_process(self):
        command = await self._command("read line; echo got-$line")
        (await self._start(command)).assert_ok()
        run = self._run(command, self.repo.root)

        ws, task = await self._attach(command)
        ws.type("ping\r")

        self.assertTrue(await _until(lambda: b"got-ping" in ws.received))
        await asyncio.wait_for(task, 5)
        self.assertEqual(ws.closed_with, 1000)
        self.assertTrue(await _until(lambda: run.exit_code == 0))

    async def test_websocket_for_a_command_that_is_not_running_closes_cleanly(self):
        command = await self._command("sleep 30")

        ws, task = await self._attach(command)
        await asyncio.wait_for(task, 5)

        self.assertEqual(ws.closed_with, 1000)
        self.assertEqual(ws.received, b"")
        self.assertEqual(self.registry.for_commands([command.id]), [])

    async def test_websocket_for_an_unknown_worktree_is_refused(self):
        command = await self._command("sleep 30")

        ws, task = await self._attach(command, str(self.repo.base / "nowhere"))
        await asyncio.wait_for(task, 5)

        self.assertEqual(ws.closed_with, 1008)
