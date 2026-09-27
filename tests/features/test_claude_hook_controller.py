"""
Feature tests for claude_hook_controller.

Focuses on the `claude_stopped` endpoint — specifically that it returns 200
and that the task-dispatch logic uses `body` (not the dropped `description`)
to identify pending work.
"""

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

    async def test_claude_stopped_marks_pending_task_in_progress(self):
        """
        When Claude stops and a pending task exists, the hook marks it
        `in_progress` using the task's `body` field (not the dropped
        `description` column) — so the PTY write uses a non-None value.
        """
        import os

        task = await TaskFactory.new().create(
            project_id=self.project.id,
            body="Implement the CSV export endpoint",
        )
        self.assertEqual(task.body, "Implement the CSV export endpoint")

        cwd = os.path.expanduser(self.project.path)
        response = await self.post("/api/claude-stopped", json={"cwd": cwd})
        response.assert_ok()

        # Give the background asyncio.create_task a moment to run
        import asyncio

        await asyncio.sleep(0.1)

        refreshed = await Task.find(task.id)
        self.assertEqual(refreshed.status, "in_progress")

    # ── /api/claude-started ───────────────────────────────────────────────────

    async def test_claude_started_returns_200_with_no_cwd(self):
        response = await self.post("/api/claude-started", json={})
        response.assert_ok()

    async def test_claude_started_marks_first_pending_task_in_progress(self):
        """UserPromptSubmit hook should mark the first pending task in_progress."""
        import os

        task = await TaskFactory.new().create(project_id=self.project.id)
        cwd = os.path.expanduser(self.project.path)

        response = await self.post("/api/claude-started", json={"cwd": cwd})
        response.assert_ok()

        refreshed = await Task.find(task.id)
        self.assertEqual(refreshed.status, "in_progress")

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
    """Backs both find_by_cwd (the claude_stopped/task_started pushes) and
    all_for_cwd (notify_agent_status) with the same recording bridge."""

    def __init__(self, cwd: str, bridge: _RecordingBridge):
        self._cwd = cwd
        self._bridge = bridge

    def find_by_cwd(self, cwd: str):
        return self._bridge if cwd == self._cwd else None

    def all_for_cwd(self, cwd: str):
        return [self._bridge] if cwd == self._cwd else []


class _FakeTerminalManager:
    """A minimal terminal manager: `find` reports which session ids are live,
    `write` is a no-op so the dispatch-to-active-agent path can run in a test."""

    def __init__(self, live_session_ids):
        self._live = set(live_session_ids)

    def find(self, session_id):
        return session_id if session_id in self._live else None

    async def write(self, session_id, data):
        pass


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

    async def test_dispatching_a_pending_task_to_the_active_agent_pushes_agent_status(self):
        """The Stop hook can immediately hand a pending task to another live agent;
        that status write must also clear a stale attention_kind and push it."""
        active = await AgentFactory.new().create(
            project_id=self.project.id,
            status="needs_input",
            attention_kind="question",
            attention_prompt="Ship it?",
            session_id="sess-active",
        )
        task = await TaskFactory.new().create(project_id=self.project.id, body="Do the thing")

        app().bind("terminal", _FakeTerminalManager(["sess-active"]))
        await _handle_claude_stopped(self.project, self.cwd, agent_id=None)

        refreshed = await Agent.find(active.id)
        self.assertEqual(refreshed.status, "running")
        self.assertIsNone(refreshed.attention_kind)
        self.assertEqual((await Task.find(task.id)).status, "in_progress")

        pushed = [p for p in self._agent_status_pushes() if p["agent_id"] == active.id]
        self.assertEqual(
            pushed,
            [
                {
                    "type": "agent_status",
                    "agent_id": active.id,
                    "status": "running",
                    "attention_kind": None,
                }
            ],
        )
