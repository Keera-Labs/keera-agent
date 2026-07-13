"""
Tests for the Claude session monitor's readiness signalling.

Regression guard for the silent first-message drop: the headless spawn used to
inject the initial task on a blind fixed timer, so if Claude was still starting
the keystrokes landed in an unready terminal and were lost. The monitor now sets
a readiness event once Claude has actually produced output, and the spawn waits
on that event before injecting — no injection into an unready PTY.
"""

import asyncio
import tempfile

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.terminal.claude_monitor import make_claude_session_monitor
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestClaudeMonitorReadiness(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._tmpdir = tempfile.mkdtemp()
        self.project = await ProjectFactory.new().create(path=self._tmpdir)
        self.agent = await AgentFactory.new().create(
            project_id=self.project.id, name="MonitorBot"
        )

    def _monitor(self, ready_event):
        return make_claude_session_monitor(
            agent_id=self.agent.id,
            terminal=None,
            terminal_manager=None,
            session_id="session-1",
            build_cmd=lambda a: "claude",
            ready_event=ready_event,
        )

    async def test_ready_event_set_once_claude_produces_output(self):
        """Substantial output (Claude has rendered its UI) fires the readiness event."""
        event = asyncio.Event()
        monitor = self._monitor(event)
        await monitor(b"\x1b[2J Welcome to Claude Code. How can I help you today?\n")
        self.assertTrue(event.is_set())

    async def test_ready_event_not_set_on_trivial_output(self):
        """A tiny burst of output must not be mistaken for readiness."""
        event = asyncio.Event()
        monitor = self._monitor(event)
        await monitor(b"\x1b[?25l")  # ANSI cursor hide only — no visible text
        self.assertFalse(event.is_set())

    async def test_ready_event_optional(self):
        """Monitor still works when no readiness event is supplied (WS path)."""
        monitor = make_claude_session_monitor(
            agent_id=self.agent.id,
            terminal=None,
            terminal_manager=None,
            session_id="session-2",
            build_cmd=lambda a: "claude",
        )
        await monitor(b"Welcome to Claude Code, ready to work now.\n")
