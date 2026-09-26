"""Regression tests for several bridges attached to one PTY.

A PTY gets a second bridge whenever a browser reattaches to a live agent: a
second tab or window, a reconnect that lands before the old socket is torn
down, or a browser opening an agent a trigger started headless. Every bridge
must keep receiving output, and the PTY must be no larger than any client's
view: a TUI drawn wider or taller than a client's xterm wraps early and its
cursor-addressed redraws land in the wrong cells, garbling that client.
"""

import asyncio
import fcntl
import json
import struct
import termios
import unittest

from app.terminal.terminal import Terminal
from app.terminal.websocket_terminal import WebsocketTerminal


class FakeWebSocket:
    def __init__(self):
        self.inbox: asyncio.Queue = asyncio.Queue()
        self.received = b""

    async def receive(self) -> dict:
        return await self.inbox.get()

    async def send_bytes(self, data: bytes) -> None:
        self.received += data

    async def send_text(self, data: str) -> None:
        pass

    def type(self, text: str) -> None:
        self.inbox.put_nowait({"type": "websocket.receive", "text": text})

    def resize(self, cols: int, rows: int, visible: bool = True) -> None:
        self.type(json.dumps({"type": "resize", "cols": cols, "rows": rows, "visible": visible}))

    def disconnect(self) -> None:
        self.inbox.put_nowait({"type": "websocket.disconnect"})


async def _until(predicate, timeout: float = 5.0) -> bool:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate():
            return True
        await asyncio.sleep(0.02)
    return predicate()


class TestSharedPty(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.terminal = Terminal(shell="/bin/sh", cwd="/tmp")
        self.terminal.start()
        self.tasks: list[asyncio.Task] = []

    async def asyncTearDown(self):
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        await self.terminal.aclose()

    def attach(self) -> FakeWebSocket:
        ws = FakeWebSocket()
        bridge = WebsocketTerminal(ws, self.terminal)
        self.tasks.append(asyncio.create_task(bridge.run(stop_on_disconnect=False)))
        return ws

    async def test_every_attached_client_receives_output(self):
        first, second = self.attach(), self.attach()
        await asyncio.sleep(0.1)

        first.type("echo shared-$((40+2))\n")

        self.assertTrue(await _until(lambda: b"shared-42" in first.received))
        self.assertTrue(await _until(lambda: b"shared-42" in second.received))

    async def test_output_keeps_flowing_after_another_client_detaches(self):
        first, second = self.attach(), self.attach()
        await asyncio.sleep(0.1)

        second.disconnect()
        await _until(lambda: self.tasks[1].done())
        first.type("echo still-$((6*7))\n")

        self.assertTrue(await _until(lambda: b"still-42" in first.received))

    def pty_size(self) -> tuple[int, int]:
        rows, cols, _, _ = struct.unpack(
            "HHHH", fcntl.ioctl(self.terminal.master_fd, termios.TIOCGWINSZ, b"\0" * 8)
        )
        return cols, rows

    async def test_the_pty_fits_the_smallest_client(self):
        first, second = self.attach(), self.attach()
        await asyncio.sleep(0.1)

        first.resize(100, 40)
        second.resize(140, 30)

        self.assertTrue(await _until(lambda: self.pty_size() == (100, 30)))

    async def test_a_larger_client_resizing_last_does_not_grow_the_pty(self):
        narrow, wide = self.attach(), self.attach()
        await asyncio.sleep(0.1)
        narrow.resize(100, 30)
        await _until(lambda: self.pty_size() == (100, 30))

        wide.resize(140, 40)
        wide.type("x")
        await asyncio.sleep(0.2)

        self.assertEqual(self.pty_size(), (100, 30))

    async def test_the_pty_grows_back_when_the_smallest_client_detaches(self):
        wide, narrow = self.attach(), self.attach()
        await asyncio.sleep(0.1)
        wide.resize(140, 40)
        narrow.resize(100, 30)
        await _until(lambda: self.pty_size() == (100, 30))

        narrow.disconnect()

        self.assertTrue(await _until(lambda: self.pty_size() == (140, 40)))

    async def test_a_client_without_a_size_does_not_constrain_the_pty(self):
        self.attach()
        sized = self.attach()
        await asyncio.sleep(0.1)

        sized.resize(120, 35)

        self.assertTrue(await _until(lambda: self.pty_size() == (120, 35)))

    async def test_a_hidden_client_does_not_shrink_the_pty(self):
        shown, background = self.attach(), self.attach()
        await asyncio.sleep(0.1)

        shown.resize(140, 40)
        background.resize(80, 20, visible=False)

        self.assertTrue(await _until(lambda: self.pty_size() == (140, 40)))
        await asyncio.sleep(0.2)
        self.assertEqual(self.pty_size(), (140, 40))

    async def test_a_client_counts_again_once_it_becomes_visible(self):
        shown, background = self.attach(), self.attach()
        await asyncio.sleep(0.1)
        shown.resize(140, 40)
        background.resize(80, 20, visible=False)
        await _until(lambda: self.pty_size() == (140, 40))

        background.resize(80, 20, visible=True)

        self.assertTrue(await _until(lambda: self.pty_size() == (80, 20)))

    async def test_the_last_size_is_kept_when_no_client_is_visible(self):
        client = self.attach()
        await asyncio.sleep(0.1)
        client.resize(120, 35)
        await _until(lambda: self.pty_size() == (120, 35))

        client.resize(90, 20, visible=False)
        await asyncio.sleep(0.2)

        self.assertEqual(self.pty_size(), (120, 35))


if __name__ == "__main__":
    unittest.main()
