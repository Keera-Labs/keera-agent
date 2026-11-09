import datetime
import json
import os
import tempfile
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app import agent_health_probe
from app.actions.agent_health_action import (
    AgentHealth,
    agent_health,
    probe_agent,
    probe_live_agents,
)
from app.mcp.tools import DeleteAgentTool, GetOrchestratedAgentsTool, HeartbeatTool, ListAgentsTool
from app.models.Agent import Agent
from app.models.AgentRelayMessage import AgentRelayMessage
from app.models.Task import Task
from app.models.TaskEvent import TaskEvent
from app.services.relay_identity import RelayCaller, acting_as
from app.services.task_policy import ALLOWED_TRANSITIONS, PRE_REVIEW_STATUSES, REQUEUE_STATUS
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from databases.factories.task_factory import TaskFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase

NOW = datetime.datetime(2026, 11, 9, 12, 0, tzinfo=datetime.UTC)


def _text(response) -> str:
    return response.to_content()[0]["text"]


def _ago(**delta) -> str:
    return (NOW - datetime.timedelta(**delta)).strftime("%Y-%m-%d %H:%M:%S")


def _agent(heartbeat=None, changed=None) -> SimpleNamespace:
    return SimpleNamespace(
        last_heartbeat_at=heartbeat, worktree_last_change_at=changed, created_at=_ago(hours=1)
    )


def _spawn_patch():
    return patch("app.controllers.agent_trigger_controller._spawn_headless_agent", new=AsyncMock())


class TestAgentHealthDerivation(TestCase):
    def test_no_live_session_is_dead(self):
        self.assertEqual(agent_health(_agent(_ago(seconds=5)), False, NOW), AgentHealth.DEAD)

    def test_recent_heartbeat_is_healthy(self):
        self.assertEqual(agent_health(_agent(_ago(seconds=30)), True, NOW), AgentHealth.HEALTHY)

    def test_heartbeat_within_five_minutes_is_quiet(self):
        self.assertEqual(agent_health(_agent(_ago(minutes=3)), True, NOW), AgentHealth.QUIET)

    def test_old_heartbeat_with_a_recent_worktree_change_is_quiet(self):
        agent = _agent(_ago(minutes=20), _ago(minutes=1))
        self.assertEqual(agent_health(agent, True, NOW), AgentHealth.QUIET)

    def test_old_heartbeat_and_unchanged_worktree_is_stalled(self):
        agent = _agent(_ago(minutes=20), _ago(minutes=30))
        self.assertEqual(agent_health(agent, True, NOW), AgentHealth.STALLED)

    def test_missing_heartbeat_falls_back_to_creation_time(self):
        self.assertEqual(agent_health(_agent(), True, NOW), AgentHealth.STALLED)


class TestPassiveHeartbeat(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.agent = await AgentFactory.new().create(project_id=self.project.id, status="running")

    async def _post_tool_use(self, agent_id: int):
        response = await self.post(
            "/api/agent-hook-events",
            json={"hook_event_name": "PostToolUse", "cwd": "/tmp/x", "tool_name": "Bash"},
            headers={"X-Keera-Agent-Id": str(agent_id)},
        )
        response.assert_ok()

    async def test_hook_event_records_a_heartbeat(self):
        await self._post_tool_use(self.agent.id)

        self.assertIsNotNone((await Agent.find(self.agent.id)).last_heartbeat_at)

    async def test_hook_event_for_a_deleted_agent_is_ignored(self):
        await Agent.where("id", self.agent.id).update({"deleted_at": _ago(minutes=1)})

        await self._post_tool_use(self.agent.id)

        self.assertIsNone((await Agent.find(self.agent.id)).last_heartbeat_at)

    async def test_heartbeat_tool_records_the_note(self):
        text = _text(
            await HeartbeatTool().handle({"agent_id": self.agent.id, "note": "running tests"})
        )

        agent = await Agent.find(self.agent.id)
        self.assertIn("Heartbeat recorded", text)
        self.assertEqual(agent.heartbeat_note, "running tests")
        self.assertIsNotNone(agent.last_heartbeat_at)

    async def test_list_agents_shows_health_and_note(self):
        await HeartbeatTool().handle({"agent_id": self.agent.id, "note": "waiting on review"})

        text = _text(await ListAgentsTool().handle({"project_path": self.project.path}))

        self.assertIn("health: dead", text)
        self.assertIn("note: waiting on review", text)

    async def test_live_session_with_fresh_heartbeat_is_healthy_for_the_orchestrator(self):
        pm = await AgentFactory.new().create(project_id=self.project.id, agent_type="pm")
        session_id = str(uuid.uuid4())
        terminals = app().make("terminal")
        terminals.create(shell="/bin/sh", cwd=tempfile.mkdtemp(), session_id=session_id)
        self.addAsyncCleanup(terminals.close, session_id)
        await Agent.where("id", self.agent.id).update(
            {"orchestrator_id": pm.id, "session_id": session_id}
        )
        await HeartbeatTool().handle({"agent_id": self.agent.id})

        text = _text(await GetOrchestratedAgentsTool().handle({"agent_id": pm.id}))

        self.assertIn('"health": "healthy"', text)

    async def test_heartbeat_without_a_note_keeps_the_previous_note(self):
        await HeartbeatTool().handle({"agent_id": self.agent.id, "note": "running tests"})

        await HeartbeatTool().handle({"agent_id": self.agent.id})

        self.assertEqual((await Agent.find(self.agent.id)).heartbeat_note, "running tests")


class TestWorktreeProbe(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = GitTestRepo(self).init()
        self.repo.write("README.md", "hello")
        self.repo.commit_all("init")
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))
        self.agent = await AgentFactory.new().create(project_id=self.project.id)

    async def test_probe_records_the_agent_worktree_state(self):
        worktree = self.repo.root / ".claude" / "worktrees" / f"agent-{self.agent.id}"
        self.repo.git("worktree", "add", "-q", "-b", "task/probe", str(worktree))
        (worktree / "work.txt").write_text("in progress")
        head = self.repo.git("rev-parse", "HEAD").strip()

        await probe_agent(self.agent)

        agent = await Agent.find(self.agent.id)
        self.assertEqual(agent.worktree_branch, "task/probe")
        self.assertEqual(agent.worktree_head_sha, head)
        self.assertIsNotNone(agent.worktree_last_commit_at)
        self.assertIsNotNone(agent.worktree_last_change_at)

    async def test_probe_follows_the_task_branch_worktree(self):
        task = await TaskFactory.new().create(project_id=self.project.id, branch="task/elsewhere")
        await Agent.where("id", self.agent.id).update({"task_id": task.id})
        worktree = self.repo.base / "elsewhere"
        self.repo.git("worktree", "add", "-q", "-b", "task/elsewhere", str(worktree))

        await probe_agent(await Agent.find(self.agent.id))

        self.assertEqual((await Agent.find(self.agent.id)).worktree_branch, "task/elsewhere")

    async def test_probe_never_rewrites_the_index_of_a_live_worktree(self):
        worktree = self.repo.root / ".claude" / "worktrees" / f"agent-{self.agent.id}"
        self.repo.git("worktree", "add", "-q", "-b", "task/probe", str(worktree))
        index = Path(
            self.repo.git(
                "rev-parse", "--path-format=absolute", "--git-path", "index", cwd=worktree
            ).strip()
        )
        os.utime(index, (1_000_000_000, 1_000_000_000))
        os.utime(worktree / "README.md", (1_500_000_000, 1_500_000_000))
        before = index.stat().st_mtime

        with patch.dict("app.services.process._ENV_OVERRIDES", {"GIT_OPTIONAL_LOCKS": "1"}):
            await probe_agent(self.agent)

        self.assertEqual(index.stat().st_mtime, before)
        self.assertFalse(index.with_name("index.lock").exists())

    async def test_one_failing_agent_does_not_skip_the_rest_of_the_sweep(self):
        await Agent.where("id", self.agent.id).update({"session_id": "broken"})
        healthy = await AgentFactory.new().create(project_id=self.project.id, session_id="fine")
        probed = []

        async def probe(agent):
            if agent.id == self.agent.id:
                raise RuntimeError("bad worktree")
            probed.append(agent.id)

        with patch("app.actions.agent_health_action.probe_agent", side_effect=probe):
            await probe_live_agents()

        self.assertIn(healthy.id, probed)

    def test_probe_loop_stops_on_app_shutdown(self):
        self.assertIn(agent_health_probe.stop, app().fastapi.router.on_shutdown)

    async def test_probe_without_a_worktree_leaves_the_agent_untouched(self):
        self.assertIsNone(await probe_agent(self.agent))
        self.assertIsNone((await Agent.find(self.agent.id)).worktree_head_sha)


class TestDeleteAgentRequeuesTask(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create(path=tempfile.mkdtemp())
        self.pm = await AgentFactory.new().create(
            project_id=self.project.id, agent_type="pm", use_worktree=False
        )
        self.task = await TaskFactory.new().create(
            project_id=self.project.id, status="in_progress", branch=None
        )
        self.agent = await AgentFactory.new().create(
            project_id=self.project.id,
            task_id=self.task.id,
            orchestrator_id=self.pm.id,
            worktree_branch="task/half-done",
            worktree_head_sha="abcdef1234567890",
            use_worktree=False,
        )

    async def _reports_to(self, agent_id: int) -> list[str]:
        rows = await AgentRelayMessage.where("to_agent_id", agent_id).get()
        return [r.content for r in rows if r.from_agent_id == self.agent.id]

    async def test_delete_tool_requeues_the_task_and_notifies_the_orchestrator(self):
        with _spawn_patch():
            text = _text(
                await DeleteAgentTool().handle({"agent_id": self.agent.id, "reason": "stuck"})
            )

        self.assertIn("has been deleted", text)
        agent = await Agent.find(self.agent.id)
        self.assertEqual(agent.status, "deleted")
        self.assertEqual(agent.deleted_reason, "stuck")
        self.assertIsNone(agent.task_id)
        task = await Task.find(self.task.id)
        self.assertEqual(task.status, "created")
        self.assertEqual(task.branch, "task/half-done")
        [event] = await TaskEvent.where("task_id", self.task.id).get()
        self.assertEqual((event.from_status, event.to_status), ("in_progress", "created"))
        [report] = await self._reports_to(self.pm.id)
        self.assertIn(f"agent deleted: {self.agent.name} (stuck)", report)
        self.assertIn(f"task #{self.task.id} is now created", report)
        self.assertIn("task/half-done @ abcdef12", report)

    async def test_ui_delete_notifies_the_project_pm_without_an_orchestrator(self):
        await Agent.where("id", self.agent.id).update({"orchestrator_id": None})

        with _spawn_patch():
            response = await self.client.delete(f"/api/agents/{self.agent.id}")

        self.assertEqual(response.status_code, 200)
        [report] = await self._reports_to(self.pm.id)
        self.assertIn("deleted from the UI", report)

    async def _delete_agent_holding_task_in(self, status: str) -> Task:
        await Task.where("id", self.task.id).update(
            {"status": status, "assignees": json.dumps([self.agent.name])}
        )
        with _spawn_patch():
            await DeleteAgentTool().handle({"agent_id": self.agent.id, "reason": "stuck"})
        return await Task.find(self.task.id)

    async def _assert_requeued_from(self, status: str) -> None:
        task = await self._delete_agent_holding_task_in(status)

        self.assertEqual(task.status, "created")
        self.assertEqual(task.assignees, [])
        self.assertEqual(task.branch, "task/half-done")
        [event] = await TaskEvent.where("task_id", self.task.id).get()
        self.assertEqual((event.from_status, event.to_status), (status, "created"))
        self.assertEqual(event.fields_changed["deleted_agent_id"], self.agent.id)
        self.assertIn(f"agent {self.agent.name} deleted: stuck", event.fields_changed["reason"])

    async def _assert_untouched_in(self, status: str) -> None:
        task = await self._delete_agent_holding_task_in(status)

        self.assertEqual(task.status, status)
        self.assertEqual(task.assignees, [self.agent.name])
        self.assertIsNone(task.branch)
        self.assertEqual(await TaskEvent.where("task_id", self.task.id).count(), 0)

    async def test_assigned_task_is_requeued(self):
        await self._assert_requeued_from("assigned")

    async def test_acked_task_is_requeued(self):
        await self._assert_requeued_from("acked")

    async def test_in_progress_task_is_requeued(self):
        await self._assert_requeued_from("in_progress")

    async def test_blocked_task_is_requeued(self):
        await self._assert_requeued_from("blocked")

    async def test_changes_requested_task_is_requeued(self):
        await self._assert_requeued_from("changes_requested")

    async def test_in_review_task_is_untouched(self):
        await self._assert_untouched_in("in_review")

    async def test_approved_task_is_untouched(self):
        await self._assert_untouched_in("approved")

    async def test_completed_task_is_untouched(self):
        await self._assert_untouched_in("completed")

    async def test_requeue_event_records_the_deleting_agent(self):
        with acting_as(RelayCaller(agent=self.pm)):
            await self._delete_agent_holding_task_in("acked")

        [event] = await TaskEvent.where("task_id", self.task.id).get()
        self.assertEqual(event.actor_agent_id, self.pm.id)

    def test_every_pre_review_status_may_legally_requeue(self):
        for status in PRE_REVIEW_STATUSES - {REQUEUE_STATUS}:
            self.assertIn(REQUEUE_STATUS, ALLOWED_TRANSITIONS[status], status)

    async def test_default_agent_worktree_branch_is_never_recorded_on_the_task(self):
        await Agent.where("id", self.agent.id).update(
            {"worktree_branch": f"worktree-agent-{self.agent.id}"}
        )

        with _spawn_patch():
            await DeleteAgentTool().handle({"agent_id": self.agent.id})

        self.assertIsNone((await Task.find(self.task.id)).branch)

    async def test_deleting_the_pm_notifies_nobody(self):
        with _spawn_patch():
            await DeleteAgentTool().handle({"agent_id": self.pm.id})

        self.assertEqual(await AgentRelayMessage.where("from_agent_id", self.pm.id).count(), 0)
