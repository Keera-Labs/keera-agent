"""
Feature tests for claude_hook_controller.

Focuses on the `claude_stopped` endpoint — specifically that it returns 200
and that the task-dispatch logic uses `body` (not the dropped `description`)
to identify pending work.
"""

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Task import Task
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
