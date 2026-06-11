"""Regression tests for Terminal.write_input space-preservation bug.

Bug: write_input previously delegated to write_raw, which writes byte-by-byte
with asyncio.sleep(0.002) delays between each character.  Those sleeps yield
control back to the event loop, letting other coroutines write to the same PTY
master fd and interleave bytes — effectively dropping or reordering spaces in
relay messages delivered to agent terminals.

Fix: write_input now writes the entire payload in a single os.write() call so
no other coroutine can interleave bytes.
"""

import asyncio
import fcntl
import os
import pty
import unittest

from app.terminal.terminal import Terminal


def _read_nonblocking(fd: int, n: int = 1024) -> bytes:
    """Read up to n bytes from fd without blocking (returns b'' if nothing available)."""
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    try:
        return os.read(fd, n)
    except (BlockingIOError, OSError):
        return b""
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


class TestWriteInputPreservesSpaces(unittest.IsolatedAsyncioTestCase):
    """Unit tests that verify write_input writes the full message atomically."""

    async def test_single_word_preserved(self):
        term, slave_fd, master_fd = _make_terminal_with_pty()
        try:
            await term.write_input(b"hello")
            # In canonical mode the PTY echoes input; read from master_fd to
            # see the echo (master reads slave output + echoed input).
            data = _read_nonblocking(master_fd, 256)
            # Alternatively read from slave_fd directly (receives what we wrote).
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
            await term.write_input(message)
            # Read the echo from the master fd (canonical-mode echo).
            data = _read_nonblocking(master_fd, 512)
            self.assertIn(b"Hello World", data,
                          "space between 'Hello' and 'World' was dropped")
            self.assertIn(b"this is a test", data,
                          "spaces inside message were dropped")
        finally:
            os.close(slave_fd)
            os.close(master_fd)

    async def test_relay_message_format_preserves_spaces(self):
        """Verify the exact format used by AgentMessageSendAction."""
        term, slave_fd, master_fd = _make_terminal_with_pty()
        try:
            relay_text = "[Message from Agent 'PM']: Task complete. Please open a PR."
            await term.write_input(relay_text.encode())
            data = _read_nonblocking(master_fd, 512)
            self.assertIn(b"Task complete.", data)
            self.assertIn(b"Please open a PR.", data)
            # Specifically check that inter-word spaces survive
            self.assertIn(b"Task complete. Please", data,
                          "space after period was dropped")
        finally:
            os.close(slave_fd)
            os.close(master_fd)

    async def test_trailing_newline_stripped_and_cr_appended(self):
        """write_input strips trailing CR/LF and appends exactly one \\r."""
        term, slave_fd, master_fd = _make_terminal_with_pty()
        try:
            await term.write_input(b"done\n")
            data = _read_nonblocking(master_fd, 256)
            self.assertIn(b"done", data)
            # The \n should be stripped and replaced with \r — no double newline.
            self.assertNotIn(b"done\n\r", data,
                             "original \\n should be stripped before \\r is appended")
        finally:
            os.close(slave_fd)
            os.close(master_fd)

    async def test_write_input_does_not_use_per_byte_sleeps(self):
        """write_input must complete without yielding to the event loop.

        The old implementation called write_raw which did asyncio.sleep(0.002)
        between every byte.  A 30-char message would sleep ~60 ms total.
        The fixed implementation uses a single os.write and completes
        essentially instantly — well under 5 ms for any normal relay message.
        """
        term, slave_fd, master_fd = _make_terminal_with_pty()
        try:
            import time
            message = b"This message has many spaces between its words"
            t0 = time.monotonic()
            await term.write_input(message)
            elapsed_ms = (time.monotonic() - t0) * 1000
            # Old code: 46 chars * 2 ms = ~92 ms.  New code: < 5 ms.
            self.assertLess(elapsed_ms, 20,
                            f"write_input took {elapsed_ms:.1f} ms — "
                            f"suggests byte-by-byte sleeping is still happening")
        finally:
            os.close(slave_fd)
            os.close(master_fd)


if __name__ == "__main__":
    unittest.main()
