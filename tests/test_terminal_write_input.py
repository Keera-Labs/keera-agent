"""Regression tests for Terminal.write() space-preservation.

Terminal now has a single write() method that calls os.write() atomically.
All relay-pattern logic (strip CR/LF, sleep 0.05 s, write \\r) lives in callers.
"""

import asyncio
import fcntl
import os
import pty
import select
import unittest

from app.terminal.terminal import Terminal


def _read_nonblocking(fd: int, n: int = 1024, timeout: float = 1.0) -> bytes:
    """Read up to n bytes from fd, waiting up to `timeout` seconds for data to arrive.

    Writing to a PTY and reading the echo/forwarded bytes back is asynchronous:
    the kernel may not have delivered them by the time we read. We therefore wait
    for readability (rather than racing with a bare non-blocking read, which is
    flaky across platforms) and then drain whatever is immediately available.
    """
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    try:
        out = b""
        while len(out) < n:
            ready, _, _ = select.select([fd], [], [], timeout if not out else 0.05)
            if not ready:
                break
            try:
                chunk = os.read(fd, n - len(out))
            except (BlockingIOError, OSError):
                break
            if not chunk:
                break
            out += chunk
        return out
    finally:
        fcntl.fcntl(fd, fcntl.F_SETFL, flags)  # restore


def _make_terminal_with_pty():
    """Return (terminal, slave_fd, master_fd) with the terminal wired to a real PTY."""
    master_fd, slave_fd = pty.openpty()
    # Construct a Terminal without starting a shell process.
    term = Terminal.__new__(Terminal)
    term._proc = None
    term.master_fd = master_fd
    return term, slave_fd, master_fd


class TestWritePreservesSpaces(unittest.IsolatedAsyncioTestCase):
    """Unit tests that verify Terminal.write() writes the full message atomically."""

    async def test_single_word_preserved(self):
        term, slave_fd, master_fd = _make_terminal_with_pty()
        try:
            await term.write(b"hello")
            data = _read_nonblocking(master_fd, 256)
            slave_data = _read_nonblocking(slave_fd, 256)
            combined = data + slave_data
            self.assertIn(b"hello", combined)
        finally:
            os.close(slave_fd)
            os.close(master_fd)

    async def test_spaces_preserved_in_multi_word_message(self):
        """Core regression: spaces between words must survive delivery."""
        term, slave_fd, master_fd = _make_terminal_with_pty()
        try:
            message = b"Hello World this is a test message"
            await term.write(message)
            data = _read_nonblocking(master_fd, 512)
            self.assertIn(b"Hello World", data, "space between 'Hello' and 'World' was dropped")
            self.assertIn(b"this is a test", data, "spaces inside message were dropped")
        finally:
            os.close(slave_fd)
            os.close(master_fd)

    async def test_relay_message_format_preserves_spaces(self):
        """Verify the exact format used by AgentMessageSendAction."""
        term, slave_fd, master_fd = _make_terminal_with_pty()
        try:
            relay_text = b"[Message from Agent 'PM']: Task complete. Please open a PR."
            await term.write(relay_text)
            data = _read_nonblocking(master_fd, 512)
            self.assertIn(b"Task complete.", data)
            self.assertIn(b"Please open a PR.", data)
            self.assertIn(b"Task complete. Please", data, "space after period was dropped")
        finally:
            os.close(slave_fd)
            os.close(master_fd)

    async def test_write_does_not_use_per_byte_sleeps(self):
        """Terminal.write() must complete without yielding to the event loop.

        A single os.write() call for any normal relay message should complete
        well under 5 ms — far below what byte-by-byte asyncio.sleep(0.002)
        would produce (46 chars * 2 ms ≈ 92 ms).
        """
        term, slave_fd, master_fd = _make_terminal_with_pty()
        try:
            import time

            message = b"This message has many spaces between its words"
            t0 = time.monotonic()
            await term.write(message)
            elapsed_ms = (time.monotonic() - t0) * 1000
            self.assertLess(
                elapsed_ms,
                20,
                f"write() took {elapsed_ms:.1f} ms — "
                f"suggests byte-by-byte sleeping is still happening",
            )
        finally:
            os.close(slave_fd)
            os.close(master_fd)

    async def test_relay_caller_pattern(self):
        """Callers strip CR/LF, write message, sleep, then write \\r separately."""
        term, slave_fd, master_fd = _make_terminal_with_pty()
        try:
            raw = b"Hello from relay\n"
            data = raw.rstrip(b"\r\n")
            await term.write(data)
            await asyncio.sleep(0.05)
            await term.write(b"\r")
            buf = _read_nonblocking(master_fd, 512)
            self.assertIn(b"Hello from relay", buf)
            # \r should follow the message text (CR enters the command)
            self.assertIn(b"\r", buf)
        finally:
            os.close(slave_fd)
            os.close(master_fd)


class TestColorEnv(unittest.TestCase):
    """The PTY must advertise a color terminal so the claude CLI emits ANSI color,
    even when the server is booted from a GUI process with no TERM (desktop build)."""

    def test_adds_color_vars_when_missing(self):
        term = Terminal(env={})
        self.assertEqual(term._env["TERM"], "xterm-256color")
        self.assertEqual(term._env["COLORTERM"], "truecolor")

    def test_preserves_existing_term(self):
        term = Terminal(env={"TERM": "screen-256color", "COLORTERM": "24bit"})
        self.assertEqual(term._env["TERM"], "screen-256color")
        self.assertEqual(term._env["COLORTERM"], "24bit")


if __name__ == "__main__":
    unittest.main()
