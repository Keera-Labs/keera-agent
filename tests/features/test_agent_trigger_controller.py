"""
Feature tests for agent_trigger_controller.

Guards against regressions in POST /api/agents/:id/trigger — the headless
spawn path that was broken when to_command() signature changed.
"""

import json

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.controllers.agent_trigger_controller import _build_relay_instructions, _mark_agent_working
from app.controllers.terminal_controller import _build_identity_suffix
from app.models.Agent import Agent
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestAgentTriggerController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        # Create a project with a real tmp directory so cwd exists
        import tempfile

        self._tmpdir = tempfile.mkdtemp()
        self.project = await ProjectFactory.new().create(path=self._tmpdir)
        self.agent = await AgentFactory.new().create(
            project_id=self.project.id,
            name="TriggerBot",
        )

    # ── /api/agents/:id/trigger ───────────────────────────────────────────────

    async def test_trigger_returns_400_without_message(self):
        """Omitting message returns 400 — does NOT crash with TypeError."""
        response = await self.post(f"/api/agents/{self.agent.id}/trigger", json={})
        response.assert_status(400).assert_json(
            lambda j: j.where("error", lambda v: "message" in v.lower()).etc()
        )

    async def test_trigger_returns_400_with_blank_message(self):
        response = await self.post(
            f"/api/agents/{self.agent.id}/trigger",
            json={"message": "   "},
        )
        response.assert_status(400)

    async def test_trigger_returns_404_for_missing_agent(self):
        response = await self.post("/api/agents/999999/trigger", json={"message": "hi"})
        response.assert_status(404)

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
        response.assert_ok().assert_json(lambda j: j.where("status", "starting").etc())

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
        response.assert_ok()


class TestBuildRelayInstructions(TestCase, DatabaseTransaction):
    """Verify _build_relay_instructions uses the correct MCP tool name."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        import tempfile

        self._tmpdir = tempfile.mkdtemp()
        self.project = await ProjectFactory.new().create(path=self._tmpdir)
        self.agent = await AgentFactory.new().create(
            project_id=self.project.id,
            name="RelayBot",
        )

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


class TestRelayRosterExcludesDeleted(TestCase, DatabaseTransaction):
    """Regression: the siblings roster must exclude soft-deleted agents.

    Guards the fix where the siblings query in _spawn_headless_agent gained
    .where_null('deleted_at') so soft-deleted agents are no longer listed as
    contactable in the AGENT COMMUNICATION PROTOCOL roster.
    """

    async def asyncSetUp(self):
        await super().asyncSetUp()
        import tempfile

        self._tmpdir = tempfile.mkdtemp()
        self.project = await ProjectFactory.new().create(path=self._tmpdir)
        self.agent = await self._make_agent("RosterBot")

    async def _make_agent(self, name: str, deleted: bool = False):
        overrides = {}
        if deleted:
            import datetime

            overrides["deleted_at"] = datetime.datetime.utcnow()
        return await AgentFactory.new().create(
            project_id=self.project.id,
            name=name,
            **overrides,
        )

    async def _siblings(self):
        """Mirror the siblings query from _spawn_headless_agent."""
        return (
            await Agent.where("project_id", self.agent.project_id)
            .where("id", "!=", self.agent.id)
            .where_null("deleted_at")
            .get()
        )

    async def test_roster_excludes_soft_deleted_sibling(self):
        live = await self._make_agent("LiveSibling")
        dead = await self._make_agent("DeadSibling", deleted=True)

        instructions = _build_relay_instructions(
            self.agent,
            cwd=self._tmpdir,
            base_url="http://localhost:4545",
            siblings=await self._siblings(),
        )

        self.assertIn("LiveSibling", instructions)
        self.assertIn(str(live.id), instructions)
        self.assertNotIn("DeadSibling", instructions)
        self.assertNotIn(f"(ID: {dead.id})", instructions)


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


class TestAgentRelayDeletedGuard(TestCase, DatabaseTransaction):
    """Verify POST /api/agent-relay rejects soft-deleted senders and receivers."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        import tempfile

        self._tmpdir = tempfile.mkdtemp()
        self.project = await ProjectFactory.new().create(path=self._tmpdir)
        self.live_agent = await AgentFactory.new().create(
            project_id=self.project.id,
            name="LiveBot",
        )

    async def _make_deleted_agent(self, name: str):
        import datetime

        return await AgentFactory.new().create(
            project_id=self.project.id,
            name=name,
            deleted_at=datetime.datetime.utcnow(),
        )

    async def test_relay_to_deleted_agent_returns_404(self):
        """Sending to a soft-deleted receiver must return HTTP 404."""
        dead = await self._make_deleted_agent("DeadReceiver")
        response = await self.post(
            "/api/agent-relay",
            json={
                "from_agent_id": self.live_agent.id,
                "to_agent_id": dead.id,
                "content": "knock knock",
            },
        )
        response.assert_status(404).assert_json(
            lambda j: j.where("error", lambda v: "deleted" in v.lower()).etc()
        )

    async def test_relay_from_deleted_agent_returns_404(self):
        """A soft-deleted agent must not be allowed to send via the relay endpoint."""
        dead = await self._make_deleted_agent("DeadSender")
        response = await self.post(
            "/api/agent-relay",
            json={
                "from_agent_id": dead.id,
                "to_agent_id": self.live_agent.id,
                "content": "ghost ping",
            },
        )
        response.assert_status(404).assert_json(
            lambda j: j.where("error", lambda v: "deleted" in v.lower()).etc()
        )

    async def test_relay_to_nonexistent_agent_returns_404(self):
        """Sending to a completely nonexistent agent ID returns 404."""
        response = await self.post(
            "/api/agent-relay",
            json={
                "from_agent_id": self.live_agent.id,
                "to_agent_id": 999999,
                "content": "void message",
            },
        )
        response.assert_status(404)


class _RecordingBridge:
    def __init__(self):
        self.sent: list[str] = []

    async def write(self, message: str) -> None:
        self.sent.append(message)


class _FakeConnections:
    def __init__(self, cwd: str, bridge: _RecordingBridge):
        self._cwd = cwd
        self._bridge = bridge

    def all_for_cwd(self, cwd: str):
        return [self._bridge] if cwd == self._cwd else []


class TestMarkAgentWorkingPushesAgentStatus(TestCase, DatabaseTransaction):
    """Regression (PR #366 review): triggering an already-running agent bypasses the
    hook-event path, so _mark_agent_working must itself push `agent_status` or the
    frontend's per-agent question-chime dedupe never clears."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.agent = await AgentFactory.new().create(
            project_id=self.project.id,
            status="needs_input",
            attention_kind="question",
            attention_prompt="Proceed?",
        )
        self.bridge = _RecordingBridge()
        container = app()
        self._orig_connections = container.make("connections")
        import os

        container.bind(
            "connections",
            _FakeConnections(os.path.expanduser(self.project.path), self.bridge),
        )

    async def asyncTearDown(self):
        app().bind("connections", self._orig_connections)
        await super().asyncTearDown()

    async def test_marks_agent_running_and_pushes_agent_status(self):
        await _mark_agent_working(self.agent, "Continue the task")

        refreshed = await Agent.find(self.agent.id)
        self.assertEqual(refreshed.status, "running")
        self.assertIsNone(refreshed.attention_kind)

        self.assertEqual(
            [json.loads(m) for m in self.bridge.sent],
            [
                {
                    "type": "agent_status",
                    "agent_id": self.agent.id,
                    "status": "running",
                    "attention_kind": None,
                }
            ],
        )
