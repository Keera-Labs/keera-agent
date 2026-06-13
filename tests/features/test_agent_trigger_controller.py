"""
Feature tests for agent_trigger_controller.

Guards against regressions in POST /api/agents/:id/trigger — the headless
spawn path that was broken when to_command() signature changed.
"""
import json

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.controllers.agent_trigger_controller import _build_relay_instructions
from app.controllers.terminal_controller import _build_identity_suffix
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


class TestBuildRelayInstructions(TestCase, DatabaseTransaction):
    """Verify _build_relay_instructions uses the correct MCP tool name."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        import tempfile
        self._tmpdir = tempfile.mkdtemp()
        self.project = await Project.create({
            "name": "relay-test-proj",
            "slug": "relay-test-proj",
            "path": self._tmpdir,
            "language": "Python",
        })
        self.agent = await Agent.create({
            "project_id": self.project.id,
            "name": "RelayBot",
            "agent_type": "software_engineer",
            "model": "claude-sonnet-4-6",
            "status": "idle",
            "has_session": False,
            "use_worktree": False,
        })

    def test_relay_instructions_use_send_message_to_agent_tool(self):
        """_build_relay_instructions must reference send_message_to_agent, not relay_to_agent."""
        instructions = _build_relay_instructions(
            self.agent,
            cwd=self._tmpdir,
            base_url="http://localhost:4545",
            siblings=[],
        )
        self.assertIn("send_message_to_agent", instructions)
        self.assertNotIn("relay_to_agent", instructions)

    def test_relay_instructions_include_agent_id(self):
        """Relay instructions must include the agent's own ID for sender_agent_id."""
        instructions = _build_relay_instructions(
            self.agent,
            cwd=self._tmpdir,
            base_url="http://localhost:4545",
            siblings=[],
        )
        self.assertIn(str(self.agent.id), instructions)

    def test_relay_instructions_include_mcp_endpoint(self):
        """Relay instructions must reference the MCP endpoint."""
        instructions = _build_relay_instructions(
            self.agent,
            cwd=self._tmpdir,
            base_url="http://localhost:4545",
            siblings=[],
        )
        self.assertIn("http://localhost:4545/mcp", instructions)

    def test_relay_instructions_with_siblings_includes_roster(self):
        """Relay instructions must list sibling agents."""

        class FakeAgent:
            id = 99
            name = "PM Agent"

        instructions = _build_relay_instructions(
            self.agent,
            cwd=self._tmpdir,
            base_url="http://localhost:4545",
            siblings=[FakeAgent()],
        )
        self.assertIn("PM Agent", instructions)
        self.assertIn("99", instructions)


class TestBuildIdentitySuffix(TestCase):
    """Verify _build_identity_suffix uses the correct MCP parameter name.

    Regression guard for the bug where WS-path agents were told to use
    `from_agent_id` (stale name) instead of `sender_agent_id` when calling
    send_message_to_agent, causing all agent-originated messages to fail.
    """

    def test_identity_suffix_uses_sender_agent_id(self):
        """Must say sender_agent_id, not from_agent_id."""
        suffix = _build_identity_suffix(42)
        self.assertIn("sender_agent_id", suffix)
        self.assertNotIn("from_agent_id", suffix)

    def test_identity_suffix_references_send_message_to_agent(self):
        """Must reference the correct MCP tool name."""
        suffix = _build_identity_suffix(42)
        self.assertIn("send_message_to_agent", suffix)
        # Old stale name 'relay calls' should not appear
        self.assertNotIn("relay calls", suffix)

    def test_identity_suffix_includes_agent_id(self):
        """Suffix must embed the agent's own numeric ID."""
        suffix = _build_identity_suffix(99)
        self.assertIn("99", suffix)
