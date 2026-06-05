import asyncio
import json
import os

from fastapi import WebSocket, WebSocketDisconnect

from app.terminal.terminal import Terminal


class WebsocketTerminal:
    def __init__(self, websocket: WebSocket, terminal: Terminal):
        self._ws = websocket
        self._terminal = terminal
        self._stopped = asyncio.Event()

    async def run(self, auto_send: bytes | None = None) -> None:
        loop = asyncio.get_event_loop()
        tasks = [
            asyncio.create_task(self._pty_to_ws(loop)),
            asyncio.create_task(self._ws_to_pty()),
            asyncio.create_task(self._watch_process(loop)),
        ]
        if auto_send:
            tasks.append(asyncio.create_task(self._auto_send(auto_send)))

        try:
            await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            for t in tasks:
                t.cancel()
            self._terminal.stop()

    async def _pty_to_ws(self, loop: asyncio.AbstractEventLoop) -> None:
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
                    item = await asyncio.wait_for(queue.get(), timeout=0.1)
                    await self._ws.send_bytes(item)
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
                    self._terminal.write(msg['bytes'])
                elif msg.get('text'):
                    try:
                        data = json.loads(msg['text'])
                        if data.get('type') == 'resize':
                            self._terminal.resize(int(data['cols']), int(data['rows']))
                    except (json.JSONDecodeError, KeyError, ValueError):
                        pass
            except (WebSocketDisconnect, Exception):
                break
        self._stopped.set()

    async def _watch_process(self, loop: asyncio.AbstractEventLoop) -> None:
        while self._terminal.is_alive() and not self._stopped.is_set():
            await asyncio.sleep(0.1)
        self._stopped.set()

    async def _auto_send(self, data: bytes) -> None:
        await asyncio.sleep(0.5)
        self._terminal.write(data)
