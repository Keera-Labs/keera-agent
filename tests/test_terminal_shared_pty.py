"""Regression tests for several bridges attached to one PTY.

A PTY gets a second bridge whenever a browser reattaches to a live agent: a
second tab or window, a reconnect that lands before the old socket is torn
down, or a browser opening an agent a trigger started headless. Every bridge
must keep receiving output, and the size of the PTY must follow the client the
user is typing in, or that client's TUI is drawn at another client's width.
"""

import asyncio
import json
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

    def resize(self, cols: int, rows: int) -> None:
        self.type(json.dumps({"type": "resize", "cols": cols, "rows": rows}))

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

    async def test_the_typing_client_owns_the_pty_size(self):
        narrow, wide = self.attach(), self.attach()
        await asyncio.sleep(0.1)
        narrow.resize(100, 30)
        wide.resize(140, 30)
        await _until(lambda: self.terminal.size == (140, 30))

        narrow.type("x")

        self.assertTrue(await _until(lambda: self.terminal.size == (100, 30)))


if __name__ == "__main__":
    unittest.main()
