import datetime
import tempfile
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.agent_health_action import AgentHealth, agent_health, probe_agent
from app.mcp.tools import DeleteAgentTool, GetOrchestratedAgentsTool, HeartbeatTool, ListAgentsTool
from app.models.Agent import Agent
from app.models.AgentRelayMessage import AgentRelayMessage
from app.models.Task import Task
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
        self.assertEqual(task.status, "pending")
        self.assertEqual(task.branch, "task/half-done")
        [report] = await self._reports_to(self.pm.id)
        self.assertIn(f"agent deleted: {self.agent.name} (stuck)", report)
        self.assertIn(f"task #{self.task.id} is now pending", report)
        self.assertIn("task/half-done @ abcdef12", report)

    async def test_ui_delete_notifies_the_project_pm_without_an_orchestrator(self):
        await Agent.where("id", self.agent.id).update({"orchestrator_id": None})

        with _spawn_patch():
            response = await self.client.delete(f"/api/agents/{self.agent.id}")

        self.assertEqual(response.status_code, 200)
        [report] = await self._reports_to(self.pm.id)
        self.assertIn("deleted from the UI", report)

    async def test_task_in_review_keeps_its_status(self):
        await Task.where("id", self.task.id).update({"status": "in_review"})

        with _spawn_patch():
            await DeleteAgentTool().handle({"agent_id": self.agent.id})

        self.assertEqual((await Task.find(self.task.id)).status, "in_review")

    async def test_deleting_the_pm_notifies_nobody(self):
        with _spawn_patch():
            await DeleteAgentTool().handle({"agent_id": self.pm.id})

        self.assertEqual(await AgentRelayMessage.where("from_agent_id", self.pm.id).count(), 0)
