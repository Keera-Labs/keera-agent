import asyncio
import os

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.controllers import project_command_run_controller
from app.models.Command import Command
from app.terminal.command_runs import FINISHED_RUNS_PER_PROJECT, CommandRunRegistry, CommandRunSpec
from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.features.test_command_run_controller import ControllerWebSocket
from tests.test_case import TestCase
from tests.test_terminal_shared_pty import _until


class TestProjectCommandRunController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = GitTestRepo(self).init()
        self.repo.write("README.md", "hello\n")
        self.repo.commit_all("initial")
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))
        self.registry: CommandRunRegistry = app().make("command_runs")

    async def asyncTearDown(self):
        for run in self.registry.for_project(self.project.id):
            await self.registry.stop_run(run)
        await super().asyncTearDown()

    def _url(self, suffix: str = "") -> str:
        return f"/api/projects/{self.project.id}/command-runs{suffix}"

    async def _run_ad_hoc(self, command: str, worktree: str | None = None):
        body = {"command": command, **({"worktree": worktree} if worktree else {})}
        return await self.post(self._url(), json=body)

    async def _index(self) -> list[dict]:
        response = await self.get(self._url())
        response.assert_ok()
        return response.json()["data"]

    async def _finish(self, run_id: str) -> None:
        run = self.registry.get(run_id)
        self.assertTrue(await _until(lambda: run.exit_code is not None))

    async def test_runs_free_text_in_the_requested_worktree(self):
        worktree = self.repo.add_worktree(".claude/worktrees/agent-8", "agent-eight")

        response = await self._run_ad_hoc("pwd", str(worktree))

        response.assert_ok()
        data = response.json()["data"]
        self.assertEqual(data["type"], "command_runs")
        self.assertIsNone(data["attributes"]["command_id"])
        self.assertEqual(data["attributes"]["label"], "pwd")
        self.assertEqual(data["attributes"]["command"], "pwd")
        self.assertEqual(data["attributes"]["worktree"], str(worktree))
        await self._finish(data["id"])
        self.assertIn(str(worktree), self.registry.get(data["id"]).terminal.history().decode())

    async def test_ad_hoc_runs_in_the_same_worktree_run_side_by_side(self):
        first = (await self._run_ad_hoc("sleep 30")).json()["data"]["id"]
        second = (await self._run_ad_hoc("sleep 30")).json()["data"]["id"]

        statuses = {item["id"]: item["attributes"]["status"] for item in await self._index()}

        self.assertEqual(statuses[first], "running")
        self.assertEqual(statuses[second], "running")

    async def test_rejects_an_empty_command(self):
        (await self._run_ad_hoc("   ")).assert_status(422)

    async def test_rejects_an_unknown_worktree_with_an_error_message(self):
        response = await self._run_ad_hoc("pwd", str(self.repo.base / "nowhere"))

        response.assert_status(422)
        self.assertIsInstance(response.json()["error"], str)

    async def test_index_lists_finished_and_running_runs_newest_first(self):
        finished = (await self._run_ad_hoc("exit 2")).json()["data"]["id"]
        await self._finish(finished)
        running = (await self._run_ad_hoc("sleep 30")).json()["data"]["id"]

        items = await self._index()

        self.assertEqual([item["id"] for item in items], [running, finished])
        self.assertEqual(items[1]["attributes"]["status"], "exited")
        self.assertEqual(items[1]["attributes"]["exit_code"], 2)
        self.assertIsNotNone(items[1]["attributes"]["ended_at"])

    async def test_index_only_lists_the_projects_own_runs(self):
        other = await ProjectFactory.new().create(path=str(self.repo.root))
        spec = CommandRunSpec(project_id=other.id, label="other", command="sleep 30")
        other_run = await self.registry.start(spec, str(self.repo.root), dict(os.environ))
        self.addAsyncCleanup(self.registry.stop_run, other_run)

        self.assertNotIn(other_run.id, [item["id"] for item in await self._index()])

    async def test_history_keeps_a_bounded_number_of_finished_runs(self):
        ids = []
        for _ in range(FINISHED_RUNS_PER_PROJECT + 2):
            ids.append((await self._run_ad_hoc("exit 0")).json()["data"]["id"])
        await asyncio.gather(*(self._finish(run_id) for run_id in ids if self.registry.get(run_id)))
        running = (await self._run_ad_hoc("sleep 30")).json()["data"]["id"]

        listed = [item["id"] for item in await self._index()]

        self.assertEqual(listed, [running, *reversed(ids[-FINISHED_RUNS_PER_PROJECT:])])

    async def test_saved_command_runs_are_listed_with_their_label(self):
        command = await Command.create(
            {"project_id": self.project.id, "label": "Tests", "command": "sleep 30"}
        )
        self.addAsyncCleanup(self.registry.forget_command, command.id)

        started = await self.post(f"/api/commands/{command.id}/runs", json={})
        commands = await self.get(f"/api/projects/{self.project.id}/commands")

        run_id = started.json()["data"]["id"]
        self.assertEqual(commands.json()["data"][0]["attributes"]["run"]["id"], run_id)
        item = next(item for item in await self._index() if item["id"] == run_id)
        self.assertEqual(item["attributes"]["command_id"], command.id)
        self.assertEqual(item["attributes"]["label"], "Tests")

    async def test_destroy_stops_an_ad_hoc_run(self):
        run_id = (await self._run_ad_hoc("sleep 30")).json()["data"]["id"]

        (await self.delete(self._url(f"/{run_id}"))).assert_no_content()

        run = self.registry.get(run_id)
        self.assertEqual(run.status, "stopped")
        self.assertIsNotNone(run.duration_ms)

    async def test_destroy_of_an_unknown_run_is_not_found(self):
        response = await self.delete(self._url("/missing"))

        response.assert_status(404)
        self.assertIsInstance(response.json()["error"], str)

    async def test_destroy_refuses_another_projects_run(self):
        other = await ProjectFactory.new().create(path=str(self.repo.root))
        spec = CommandRunSpec(project_id=other.id, label="other", command="sleep 30")
        other_run = await self.registry.start(spec, str(self.repo.root), dict(os.environ))
        self.addAsyncCleanup(self.registry.stop_run, other_run)

        (await self.delete(self._url(f"/{other_run.id}"))).assert_status(404)
        self.assertEqual(other_run.status, "running")

    async def _attach(self, run_id: str) -> ControllerWebSocket:
        ws = ControllerWebSocket()
        await asyncio.wait_for(
            project_command_run_controller.attach(ws, self.project.slug, run_id), 5
        )
        return ws

    async def test_websocket_replays_a_finished_runs_output(self):
        run_id = (await self._run_ad_hoc("echo ad-hoc-output")).json()["data"]["id"]
        await self._finish(run_id)

        ws = await self._attach(run_id)

        self.assertIn(b"ad-hoc-output", ws.received)

    async def test_websocket_for_an_unknown_run_is_refused(self):
        ws = await self._attach("missing")

        self.assertEqual(ws.closed_with, 1008)
