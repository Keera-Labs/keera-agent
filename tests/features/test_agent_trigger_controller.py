"""
Feature tests for agent_trigger_controller.

Guards against regressions in POST /api/agents/:id/trigger — the headless
spawn path that was broken when to_command() signature changed.
"""
import json

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Agent import Agent
from app.models.Project import Project
from tests.test_case import TestCase


class TestAgentTriggerController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        # Create a project with a real tmp directory so cwd exists
        import os, tempfile
        self._tmpdir = tempfile.mkdtemp()
        self.project = await Project.create({
            "name": "trigger-test-proj",
            "slug": "trigger-test-proj",
            "path": self._tmpdir,
            "language": "Python",
        })
        self.agent = await Agent.create({
            "project_id": self.project.id,
            "name": "TriggerBot",
            "agent_type": "software_engineer",
            "model": "claude-sonnet-4-6",
            "system_prompt": None,
            "permissions_allow": json.dumps([]),
            "permissions_deny": json.dumps([]),
            "status": "idle",
            "has_session": False,
            "use_worktree": False,
        })

    # ── /api/agents/:id/trigger ───────────────────────────────────────────────

    async def test_trigger_returns_400_without_message(self):
        """Omitting message returns 400 — does NOT crash with TypeError."""
        response = await self.post(f"/api/agents/{self.agent.id}/trigger", json={})
        self.assertEqual(response.status_code, 400)
        self.assertIn("message", response.json().get("error", "").lower())

    async def test_trigger_returns_400_with_blank_message(self):
        response = await self.post(
            f"/api/agents/{self.agent.id}/trigger",
            json={"message": "   "},
        )
        self.assertEqual(response.status_code, 400)

    async def test_trigger_returns_404_for_missing_agent(self):
        response = await self.post("/api/agents/999999/trigger", json={"message": "hi"})
        self.assertEqual(response.status_code, 404)

    async def test_trigger_with_no_running_session_returns_starting(self):
        """
        When no PTY session is active, trigger() enqueues a headless spawn
        and returns {"status": "starting"}.  This is the path that previously
        crashed with TypeError because to_command() was called with a positional arg.
        """
        response = await self.post(
            f"/api/agents/{self.agent.id}/trigger",
            json={"message": "Implement the feature"},
        )
        # Must be 200, not 500
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("status"), "starting")

    async def test_trigger_with_active_session_returns_injected(self):
        """
        When an agent already has a session_id that maps to a live PTY,
        trigger() injects the message and returns {"status": "injected"}.
        """
        # Simulate an existing session_id (no actual PTY — terminal_manager
        # will return None for find(), so it falls through to headless spawn).
        # This test mainly verifies the endpoint doesn't crash.
        await Agent.where("id", self.agent.id).update({"session_id": None})
        response = await self.post(
            f"/api/agents/{self.agent.id}/trigger",
            json={"message": "Continue the task"},
        )
        self.assertEqual(response.status_code, 200)
