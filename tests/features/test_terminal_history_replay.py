"""A browser opening an agent whose PTY is already running (page reload, or a
trigger started it headless) gets a fresh xterm. Without the PTY's recent
output replayed into it, that xterm stays blank until the CLI happens to
redraw, so the user can't see what the agent is doing.
"""

import asyncio
import fcntl
import json
import os
import struct
import sys
import tempfile
import termios
import unittest

from app.terminal.terminal import Terminal
from app.terminal.websocket_terminal import WebsocketTerminal
from tests.test_terminal_shared_pty import FakeWebSocket, _until

SIZE_WATCHER = """
import os, signal, time
last = os.get_terminal_size(0)
def on_winch(*_):
    global last
    size = os.get_terminal_size(0)
    if size != last:
        last = size
        print(f"resized-{size.lines}x{size.columns}", flush=True)
signal.signal(signal.SIGWINCH, on_winch)
print("watching", flush=True)
while True:
    time.sleep(0.05)
"""


class TestTerminalHistory(unittest.TestCase):
    def test_history_keeps_raw_output_including_escapes(self):
        terminal = Terminal()

        terminal.record_history(b"\x1b[32mhello\x1b[0m\r\n")
        terminal.record_history(b"world")

        self.assertEqual(terminal.history(), b"\x1b[32mhello\x1b[0m\r\nworld")

    def test_history_is_bounded_and_starts_on_a_line_boundary(self):
        terminal = Terminal()
        terminal.history_limit = 32

        for n in range(20):
            terminal.record_history(f"line-{n:02d}\r\n".encode())

        history = terminal.history()
        self.assertLessEqual(len(history), 32)
        self.assertTrue(history.startswith(b"line-"))
        self.assertTrue(history.endswith(b"line-19\r\n"))

    def test_a_single_oversized_chunk_keeps_its_tail(self):
        terminal = Terminal()
        terminal.history_limit = 16

        terminal.record_history(b"x" * 100)

        self.assertEqual(terminal.history(), b"x" * 16)

    def test_trimming_never_starts_inside_an_escape_sequence(self):
        terminal = Terminal()
        terminal.history_limit = 12

        terminal.record_history(b"\x1b[38;5;208mab\x1b[0mcd")

        self.assertEqual(terminal.history(), b"\x1b[0mcd")

    def test_trimming_never_starts_inside_a_multibyte_char(self):
        terminal = Terminal()
        terminal.history_limit = 5

        terminal.record_history("··ab".encode())

        history = terminal.history()
        self.assertEqual(history, "·ab".encode())
        history.decode("utf-8")


class TestHistoryQueries(unittest.TestCase):
    """Replayed queries would make the new xterm answer them into the live PTY."""

    def test_queries_are_left_out_of_the_history(self):
        terminal = Terminal()

        terminal.record_history(
            b"a\x1b[cb\x1b[0cc\x1b[>cd\x1b[6ne\x1b[?6nf\x1b]11;?\x07g\x1b]10;?\x1b\\h"
            b"\x1b[>qi\x1b[?2026$pj\x1b[?uk\x1b[18tl\x1bP$qm\x1b\\n"
        )

        self.assertEqual(terminal.history(), b"abcdefghijkln")

    def test_colour_and_cursor_sequences_are_kept(self):
        terminal = Terminal()
        output = b"\x1b[38;5;208mhi\x1b[0m\x1b[2K\x1b[1A\x1b]0;title\x07\x1b[?25l"

        terminal.record_history(output)

        self.assertEqual(terminal.history(), output)

    def test_a_query_split_across_chunks_is_still_left_out(self):
        terminal = Terminal()

        terminal.record_history(b"X\x1b[")
        terminal.record_history(b"c\n\x1b]11")
        terminal.record_history(b";?\x1b")
        terminal.record_history(b"\\Y")

        self.assertEqual(terminal.history(), b"X\nY")

    def test_a_partial_sequence_is_replayed_so_the_live_rest_still_renders(self):
        terminal = Terminal()

        terminal.record_history(b"X\x1b[38;5")

        self.assertEqual(terminal.history(), b"X\x1b[38;5")


class TestHistoryReplay(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.terminal = Terminal(shell="/bin/sh", cwd="/tmp")
        self.terminal.start()
        self.tasks: list[asyncio.Task] = []
        self.tmp = tempfile.TemporaryDirectory()

    async def asyncTearDown(self):
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        await self.terminal.aclose()
        self.tmp.cleanup()

    def pty_size(self) -> tuple[int, int]:
        rows, cols, _, _ = struct.unpack(
            "HHHH", fcntl.ioctl(self.terminal.master_fd, termios.TIOCGWINSZ, b"\0" * 8)
        )
        return cols, rows

    def attach(self, replay_history: bool) -> FakeWebSocket:
        ws = FakeWebSocket()
        bridge = WebsocketTerminal(ws, self.terminal, replay_history=replay_history)
        self.tasks.append(asyncio.create_task(bridge.run(stop_on_disconnect=False)))
        return ws

    async def test_a_reattaching_client_first_receives_earlier_output(self):
        first = self.attach(replay_history=False)
        await asyncio.sleep(0.1)
        first.type("echo before-$((40+2))\n")
        await _until(lambda: b"before-42" in first.received)

        late = self.attach(replay_history=True)

        self.assertTrue(await _until(lambda: b"before-42" in late.received))

    async def test_replayed_output_is_not_duplicated_by_live_output(self):
        first = self.attach(replay_history=False)
        await asyncio.sleep(0.1)
        first.type("echo before-$((40+2))\n")
        await _until(lambda: b"before-42" in first.received)

        late = self.attach(replay_history=True)
        first.type("echo after-$((6*7))\n")
        await _until(lambda: b"after-42" in late.received)
        await asyncio.sleep(0.2)

        self.assertEqual(late.received.count(b"before-42"), first.received.count(b"before-42"))
        self.assertEqual(late.received.count(b"after-42"), first.received.count(b"after-42"))

    async def test_replay_comes_before_live_output_with_no_gap(self):
        first = self.attach(replay_history=False)
        await asyncio.sleep(0.1)
        first.type("i=0; while [ $i -lt 300 ]; do echo tick-$i; i=$((i+1)); done\n")
        late = self.attach(replay_history=True)
        await _until(lambda: b"tick-299" in first.received)
        await _until(lambda: b"tick-299" in late.received)

        self.assertTrue(first.received.endswith(late.received))
        self.assertIn(b"tick-299", late.received)

    async def start_size_watcher(self, client: FakeWebSocket) -> None:
        """Run a program that, like Node, reacts only when the size really changes."""
        script = os.path.join(self.tmp.name, "watch_size.py")
        with open(script, "w") as f:
            f.write(SIZE_WATCHER)
        client.type(f"{sys.executable} {script}\n")
        self.assertTrue(await _until(lambda: b"watching" in client.received))

    async def test_the_pty_is_the_shells_controlling_terminal_so_resizes_signal_it(self):
        self.assertEqual(os.tcgetpgrp(self.terminal.master_fd), os.getpgid(self.terminal.pid))

    async def test_a_reattaching_client_makes_the_cli_see_a_real_resize_at_an_unchanged_size(self):
        first = self.attach(replay_history=False)
        await asyncio.sleep(0.1)
        first.resize(80, 24)
        await self.start_size_watcher(first)

        late = self.attach(replay_history=True)
        await asyncio.sleep(0.1)
        late.resize(80, 24)

        self.assertTrue(await _until(lambda: b"resized-24x80" in first.received))
        self.assertIn(b"resized-23x80", first.received)
        self.assertEqual(self.pty_size(), (80, 24))

    async def test_a_client_resize_during_the_nudge_wins(self):
        client = self.attach(replay_history=True)
        await asyncio.sleep(0.1)
        await self.start_size_watcher(client)

        client.resize(80, 24)
        await asyncio.sleep(0.05)
        client.resize(100, 30)
        await asyncio.sleep(self.terminal.redraw_nudge + 0.3)

        self.assertEqual(self.pty_size(), (100, 30))
        self.assertTrue(client.received.rstrip().endswith(b"resized-30x100"))

    async def test_a_query_in_the_history_is_not_replayed(self):
        first = self.attach(replay_history=False)
        await asyncio.sleep(0.1)
        first.type("printf 'X\\033[cY\\n'\n")
        await _until(lambda: b"XY" in first.received)

        late = self.attach(replay_history=True)

        self.assertTrue(await _until(lambda: b"XY" in late.received))
        self.assertNotIn(b"\x1b[c", late.received)

    async def test_terminal_responses_are_dropped_until_the_replay_is_rendered(self):
        first = self.attach(replay_history=False)
        await asyncio.sleep(0.1)
        first.type("echo ready\n")
        await _until(lambda: b"ready" in first.received.split(b"echo ready")[-1])

        late = self.attach(replay_history=True)
        await _until(lambda: b"ready" in late.received)
        late.type("\x1b[?1;2c")
        late.type("echo typed-$((40+2))\n")
        self.assertTrue(await _until(lambda: b"typed-42" in first.received))
        self.assertNotIn(b"1;2c", first.received)

        late.type(json.dumps({"type": "replay_done"}))
        late.type("\x1b[?1;2c")

        self.assertTrue(await _until(lambda: b"1;2c" in first.received))

    async def test_a_client_without_replay_only_sees_new_output(self):
        first = self.attach(replay_history=False)
        await asyncio.sleep(0.1)
        first.type("echo before-$((40+2))\n")
        await _until(lambda: b"before-42" in first.received)

        late = self.attach(replay_history=False)
        await asyncio.sleep(0.2)

        self.assertNotIn(b"before-42", late.received)


if __name__ == "__main__":
    unittest.main()
