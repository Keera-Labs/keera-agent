import asyncio
import json
import os

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.controllers.claude_hook_controller import _handle_claude_stopped
from app.models.Agent import Agent
from app.models.Task import Task
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from databases.factories.task_factory import TaskFactory
from tests.test_case import TestCase


class TestClaudeHookController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()

    # ── /api/claude-stopped ───────────────────────────────────────────────────

    async def test_claude_stopped_returns_200_with_no_cwd(self):
        """Missing cwd is a no-op — should not crash."""
        response = await self.post("/api/claude-stopped", json={})
        response.assert_ok()

    async def test_claude_stopped_returns_200_with_unknown_cwd(self):
        """Unknown cwd returns 200; no project match is a graceful no-op."""
        response = await self.post("/api/claude-stopped", json={"cwd": "/tmp/nonexistent-path-xyz"})
        response.assert_ok()

    async def test_claude_stopped_marks_project_idle(self):
        """Claude stopping for a known project marks it claude_status=idle."""
        import os

        cwd = os.path.expanduser(self.project.path)

        await self.post("/api/claude-stopped", json={"cwd": cwd})

        from app.models.Project import Project

        refreshed = await Project.find(self.project.id)
        self.assertEqual(refreshed.claude_status, "idle")

    async def test_claude_stopped_leaves_pending_tasks_pending(self):
        task = await TaskFactory.new().create(project_id=self.project.id, body="Implement it")

        await self._stop()

        self.assertEqual((await Task.find(task.id)).status, "pending")

    async def test_claude_started_route_is_gone(self):
        response = await self.post("/api/claude-started", json={})
        self.assertEqual(response.status_code, 404)

    # ── per-agent Stop attribution ────────────────────────────────────────────

    async def _stop(self, headers: dict | None = None, cwd: str | None = None):
        cwd = cwd or os.path.expanduser(self.project.path)
        response = await self.post("/api/claude-stopped", json={"cwd": cwd}, headers=headers or {})
        response.assert_ok()
        await asyncio.sleep(0.1)

    async def test_claude_stopped_with_agent_header_only_marks_that_agent_waiting(self):
        stopping = await AgentFactory.new().create(
            project_id=self.project.id,
            status="needs_input",
            attention_kind="question",
            attention_prompt="Proceed?",
        )
        sibling = await AgentFactory.new().create(project_id=self.project.id, status="running")

        await self._stop({"X-Keera-Agent-Id": str(stopping.id)})

        stopped = await Agent.find(stopping.id)
        self.assertEqual(stopped.status, "waiting")
        self.assertIsNone(stopped.attention_prompt)
        self.assertEqual((await Agent.find(sibling.id)).status, "running")

    async def test_claude_stopped_attributes_by_agent_worktree_cwd_without_header(self):
        stopping = await AgentFactory.new().create(project_id=self.project.id, status="running")
        sibling = await AgentFactory.new().create(project_id=self.project.id, status="running")
        worktree = os.path.join(
            os.path.expanduser(self.project.path), ".claude", "worktrees", f"agent-{stopping.id}"
        )

        await self._stop(cwd=worktree)

        self.assertEqual((await Agent.find(stopping.id)).status, "waiting")
        self.assertEqual((await Agent.find(sibling.id)).status, "running")

    async def test_unattributed_claude_stopped_leaves_working_agents_running(self):
        """A Stop from another session in the project (PM, the user's own claude) says
        nothing about which agent stopped, so it must not flip working agents."""
        first = await AgentFactory.new().create(project_id=self.project.id, status="running")
        second = await AgentFactory.new().create(project_id=self.project.id, status="running")

        await self._stop({"X-Keera-Agent-Id": "$KEERA_AGENT_ID"})

        self.assertEqual((await Agent.find(first.id)).status, "running")
        self.assertEqual((await Agent.find(second.id)).status, "running")


class _RecordingBridge:
    def __init__(self):
        self.sent: list[str] = []

    async def write(self, message: str) -> None:
        self.sent.append(message)


class _FakeConnections:
    """Backs both find_by_cwd (the claude_stopped push) and
    all_for_cwd (notify_agent_status) with the same recording bridge."""

    def __init__(self, cwd: str, bridge: _RecordingBridge):
        self._cwd = cwd
        self._bridge = bridge

    def find_by_cwd(self, cwd: str):
        return self._bridge if cwd == self._cwd else None

    def all_for_cwd(self, cwd: str):
        return [self._bridge] if cwd == self._cwd else []


class _FakeTerminalManager:
    def __init__(self, live_session_ids):
        self._live = set(live_session_ids)
        self.writes: list[tuple[str, bytes]] = []

    def find(self, session_id):
        return session_id if session_id in self._live else None

    async def write(self, session_id, data):
        self.writes.append((session_id, data))


class TestClaudeStoppedPushesAgentStatus(TestCase, DatabaseTransaction):
    """Regression: a Stop only pushes `claude_stopped` (no agent_id), so any agent
    status change it causes must push `agent_status` itself or the frontend's
    per-agent question-chime dedupe never clears (PR #366 review)."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.cwd = os.path.expanduser(self.project.path)
        self.bridge = _RecordingBridge()
        container = app()
        self._orig_connections = container.make("connections")
        self._orig_terminal = container.make("terminal")
        container.bind("connections", _FakeConnections(self.cwd, self.bridge))

    async def asyncTearDown(self):
        container = app()
        container.bind("connections", self._orig_connections)
        container.bind("terminal", self._orig_terminal)
        await super().asyncTearDown()

    def _agent_status_pushes(self) -> list[dict]:
        return [
            payload
            for message in self.bridge.sent
            if (payload := json.loads(message)).get("type") == "agent_status"
        ]

    async def test_stop_pushes_agent_status_waiting_for_the_stopped_agent(self):
        stopping = await AgentFactory.new().create(
            project_id=self.project.id, status="needs_input", attention_kind="question"
        )

        response = await self.post(
            "/api/claude-stopped",
            json={"cwd": self.cwd},
            headers={"X-Keera-Agent-Id": str(stopping.id)},
        )
        response.assert_ok()
        await asyncio.sleep(0.1)

        self.assertEqual(
            self._agent_status_pushes(),
            [
                {
                    "type": "agent_status",
                    "agent_id": stopping.id,
                    "status": "waiting",
                    "attention_kind": None,
                }
            ],
        )

    async def test_stop_does_not_push_for_an_agent_it_did_not_change(self):
        """An agent that was neither running nor needs_input is left alone, so
        the write matches none and no push should fire."""
        already_waiting = await AgentFactory.new().create(
            project_id=self.project.id, status="waiting"
        )

        await self.post(
            "/api/claude-stopped",
            json={"cwd": self.cwd},
            headers={"X-Keera-Agent-Id": str(already_waiting.id)},
        )
        await asyncio.sleep(0.1)

        self.assertEqual(self._agent_status_pushes(), [])

    async def test_unattributed_stop_injects_nothing_into_live_agent_or_pm_sessions(self):
        worker = await AgentFactory.new().create(
            project_id=self.project.id,
            status="needs_input",
            attention_kind="question",
            session_id="sess-worker",
        )
        pm = await AgentFactory.new().create(
            project_id=self.project.id,
            agent_type="pm",
            status="waiting",
            session_id="sess-pm",
        )
        task = await TaskFactory.new().create(project_id=self.project.id, body=None)
        terminal = _FakeTerminalManager(["sess-worker", "sess-pm"])
        app().bind("terminal", terminal)

        await _handle_claude_stopped(self.project, self.cwd, agent_id=None)

        self.assertEqual(terminal.writes, [])
        self.assertEqual((await Task.find(task.id)).status, "pending")
        self.assertEqual((await Agent.find(worker.id)).status, "needs_input")
        self.assertEqual((await Agent.find(pm.id)).status, "waiting")
        self.assertEqual(self._agent_status_pushes(), [])
        self.assertFalse(any(json.loads(m).get("type") == "task_started" for m in self.bridge.sent))
