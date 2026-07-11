"""Unit tests for TerminalWriteAction and Terminal.send().

TerminalWriteAction.resolve_terminal() picks the live PTY for a session across
four paths: (1) no session id, (2) an active WebSocket bridge, (3) a detached
TerminalManager session, (4) nothing found. execute() sends the message only
when a terminal resolves. Terminal.send() strips a trailing CR/LF from the
message and appends a single CR so the target treats it as one submitted line.
"""

import os
import pty
import tty
import unittest

from fastapi_startkit.application import app

from app.actions.terminal_write_action import TerminalWriteAction
from app.terminal.terminal import Terminal
from tests.test_case import TestCase


class _RecordingTerminal:
    def __init__(self):
        self.sent: list[str] = []

    async def send(self, message: str) -> None:
        self.sent.append(message)


class _Bridge:
    def __init__(self, terminal):
        self.terminal = terminal


class _FakeConnections:
    def __init__(self, mapping=None):
        self._m = mapping or {}

    def get(self, key):
        return self._m.get(key)


class _FakeTerminals:
    def __init__(self, mapping=None):
        self._m = mapping or {}

    def find(self, key):
        return self._m.get(key)


class TestTerminalWriteActionResolution(TestCase):
    """resolve_terminal() must cover all four lookup paths, and execute() must
    only deliver when a terminal is found."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        container = app()
        self._orig_connections = container.make("connections")
        self._orig_terminal = container.make("terminal")

    async def asyncTearDown(self):
        container = app()
        container.bind("connections", self._orig_connections)
        container.bind("terminal", self._orig_terminal)
        await super().asyncTearDown()

    def _bind(self, connections, terminals):
        container = app()
        container.bind("connections", connections)
        container.bind("terminal", terminals)

    async def test_no_session_id_resolves_to_none(self):
        """Path 1: a null session id short-circuits both lookups."""
        self._bind(_FakeConnections(), _FakeTerminals())
        action = TerminalWriteAction.prepare(None, "hi")
        self.assertIsNone(action.resolve_terminal())
        self.assertFalse(await action.execute())

    async def test_websocket_bridge_takes_precedence(self):
        """Path 2: an active WebSocket bridge wins over the manager."""
        ws_terminal = _RecordingTerminal()
        manager_terminal = _RecordingTerminal()
        self._bind(
            _FakeConnections({"s1": _Bridge(ws_terminal)}),
            _FakeTerminals({"s1": manager_terminal}),
        )
        action = TerminalWriteAction.prepare("s1", "hello")
        self.assertIs(action.resolve_terminal(), ws_terminal)
        self.assertTrue(await action.execute())
        self.assertEqual(ws_terminal.sent, ["hello"])
        self.assertEqual(manager_terminal.sent, [])

    async def test_falls_back_to_terminal_manager(self):
        """Path 3: with no bridge, the detached manager session resolves."""
        manager_terminal = _RecordingTerminal()
        self._bind(_FakeConnections(), _FakeTerminals({"s2": manager_terminal}))
        action = TerminalWriteAction.prepare("s2", "run tests")
        self.assertIs(action.resolve_terminal(), manager_terminal)
        self.assertTrue(await action.execute())
        self.assertEqual(manager_terminal.sent, ["run tests"])

    async def test_unknown_session_resolves_to_none(self):
        """Path 4: a session id known to neither store yields no terminal."""
        self._bind(_FakeConnections(), _FakeTerminals())
        action = TerminalWriteAction.prepare("ghost", "hi")
        self.assertIsNone(action.resolve_terminal())
        self.assertFalse(await action.execute())


class TestTerminalSend(unittest.IsolatedAsyncioTestCase):
    """Terminal.send() strips a trailing newline from the message and appends a
    single CR so the message is submitted as one line."""

    async def test_send_strips_trailing_newline_and_appends_cr(self):
        master_fd, slave_fd = pty.openpty()
        # Raw slave: no echo or CR/LF translation, so bytes read back equal
        # exactly what send() wrote.
        tty.setraw(slave_fd)
        term = Terminal.__new__(Terminal)
        term._proc = None
        term.master_fd = master_fd
        term._write_lock = None
        try:
            await term.send("deploy now\r\n")
            received = os.read(slave_fd, 1024)
        finally:
            os.close(slave_fd)
            os.close(master_fd)

        self.assertEqual(received, b"deploy now\r")

    async def test_send_preserves_inner_spaces(self):
        master_fd, slave_fd = pty.openpty()
        tty.setraw(slave_fd)
        term = Terminal.__new__(Terminal)
        term._proc = None
        term.master_fd = master_fd
        term._write_lock = None
        try:
            await term.send("Hello World this is one line")
            received = os.read(slave_fd, 1024)
        finally:
            os.close(slave_fd)
            os.close(master_fd)

        self.assertEqual(received, b"Hello World this is one line\r")


if __name__ == "__main__":
    unittest.main()
