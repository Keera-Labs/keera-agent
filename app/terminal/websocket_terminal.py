import asyncio
import json
import os
from collections.abc import Callable, Awaitable

from fastapi import WebSocket, WebSocketDisconnect

from app.terminal.terminal import Terminal


class WebsocketTerminal:
    def __init__(
        self,
        websocket: WebSocket | None,
        terminal: Terminal,
        on_output: Callable[[bytes], Awaitable[None]] | None = None,
    ):
        self._ws = websocket
        self._terminal = terminal
        self._on_output = on_output
        self._stopped = asyncio.Event()

    async def run(
        self,
        auto_send: bytes | None = None,
        stop_on_disconnect: bool = True,
        on_start: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        loop = asyncio.get_event_loop()
        tasks = []

        tasks += [
            asyncio.create_task(self._read_pty(loop)),
            asyncio.create_task(self._watch_process(loop)),
        ]
        if self._ws is not None:
            tasks.append(asyncio.create_task(self._ws_to_pty()))

        if auto_send:
            tasks.append(asyncio.create_task(self._auto_send(auto_send)))
        if on_start:
            tasks.append(asyncio.create_task(on_start()))

        try:
            await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            for t in tasks:
                t.cancel()
            if stop_on_disconnect and self._ws is not None:
                self._terminal.stop()

    async def _read_pty(self, loop: asyncio.AbstractEventLoop) -> None:
        master_fd = self._terminal.master_fd
        queue: asyncio.Queue = asyncio.Queue()

        def on_readable():
            try:
                data = os.read(master_fd, 4096)
                if data:
                    queue.put_nowait(data)
            except OSError:
                pass

        loop.add_reader(master_fd, on_readable)
        try:
            while not self._stopped.is_set():
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=0.1)
                    if self._ws is not None:
                        await self._ws.send_bytes(data)
                    if self._on_output:
                        await self._on_output(data)
                except asyncio.TimeoutError:
                    continue
        finally:
            try:
                loop.remove_reader(master_fd)
            except Exception:
                pass

    async def _ws_to_pty(self) -> None:
        while not self._stopped.is_set():
            try:
                msg = await self._ws.receive()
                if msg.get('type') == 'websocket.disconnect':
                    break
                if msg.get('bytes'):
                    # Binary = message send → write_input auto-appends \r
                    await self._terminal.write_input(msg['bytes'])
                elif msg.get('text'):
                    text: str = msg['text']
                    try:
                        parsed = json.loads(text)
                        if isinstance(parsed, dict) and parsed.get('type') == 'resize':
                            self._terminal.resize(int(parsed['cols']), int(parsed['rows']))
                        else:
                            # Text = raw keyboard from term.onData → no modification
                            await self._terminal.write_raw(text.encode())
                    except (json.JSONDecodeError, ValueError):
                        await self._terminal.write_raw(text.encode())
            except (WebSocketDisconnect, Exception):
                break
        self._stopped.set()

    async def _watch_process(self, loop: asyncio.AbstractEventLoop) -> None:
        while self._terminal.is_alive() and not self._stopped.is_set():
            await asyncio.sleep(0.1)
        self._stopped.set()

    @property
    def websocket(self) -> WebSocket | None:
        return self._ws

    async def write(self, data: bytes | str) -> None:
        await self._terminal.write_input(data if isinstance(data, bytes) else data.encode())

    async def write_relay_message(self, data: bytes | str) -> None:
        await self._terminal.write_relay_message(data if isinstance(data, bytes) else data.encode())

    async def send_text(self, data: str) -> None:
        if self._ws:
            await self._ws.send_text(data)

    async def send_bytes(self, data: bytes) -> None:
        if self._ws:
            await self._ws.send_bytes(data)

    async def _auto_send(self, data: bytes) -> None:
        await asyncio.sleep(0.5)
        await self._terminal.write_input(data)
