import asyncio
import json
from collections.abc import Awaitable, Callable

from fastapi import WebSocket, WebSocketDisconnect

from app.terminal.terminal import Terminal


class WebsocketTerminal:
    def __init__(
        self,
        websocket: WebSocket | None,
        terminal: Terminal,
        on_output: Callable[[bytes], Awaitable[None]] | None = None,
        on_restart: Callable[[], Awaitable[object]] | None = None,
        replay_history: bool = False,
    ):
        self._ws = websocket
        self._terminal = terminal
        self._on_output = on_output
        self._on_restart = on_restart
        # A client attaching to a running PTY starts from a blank xterm: replay
        # recent output, then have the CLI repaint once the client's size is known.
        self._replay_history = replay_history
        self._needs_redraw = replay_history
        self._restart_task: asyncio.Task | None = None
        self._stopped = asyncio.Event()

    @property
    def terminal(self) -> Terminal:
        return self._terminal

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
            # Let the cancelled reader unregister the master fd before it is closed.
            await asyncio.gather(*tasks, return_exceptions=True)
            self._terminal.remove_client(self)
            if stop_on_disconnect and self._ws is not None:
                await self._terminal.aclose()

    async def _read_pty(self, loop: asyncio.AbstractEventLoop) -> None:
        queue = self._terminal.subscribe(with_history=self._replay_history)
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
            self._terminal.unsubscribe(queue)

    async def _ws_to_pty(self) -> None:
        while not self._stopped.is_set():
            try:
                msg = await self._ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                if msg.get("bytes"):
                    # Binary = a composed message to type in and submit.
                    text = msg["bytes"].decode(errors="replace")
                    if text.strip("\r\n"):
                        await self._terminal.send(text)
                elif msg.get("text"):
                    text: str = msg["text"]
                    try:
                        parsed = json.loads(text)
                        if isinstance(parsed, dict) and parsed.get("type") == "resize":
                            self._resize(parsed)
                        elif isinstance(parsed, dict) and parsed.get("type") == "restart_cli":
                            self._request_restart()
                        else:
                            # Text = raw keyboard from term.onData → no modification
                            await self._terminal.write(text.encode())
                    except (json.JSONDecodeError, ValueError):
                        await self._terminal.write(text.encode())
            except (WebSocketDisconnect, Exception):
                break
        self._stopped.set()

    def _resize(self, message: dict) -> None:
        before = self._terminal.size
        self._terminal.set_client_size(
            self,
            int(message["cols"]),
            int(message["rows"]),
            visible=bool(message.get("visible", True)),
        )
        # A size change already signals the CLI; an unchanged size needs an explicit
        # nudge, since a replayed byte stream of a cursor-addressed TUI captured at
        # another size or cut mid-screen can land in the wrong cells.
        if self._needs_redraw:
            self._needs_redraw = False
            if self._terminal.size == before:
                self._terminal.force_redraw()

    def _request_restart(self) -> None:
        # Runs off the receive loop: a restart waits for the CLI to stop and boot.
        if self._on_restart and not (self._restart_task and not self._restart_task.done()):
            self._restart_task = asyncio.create_task(self._on_restart())

    async def _watch_process(self, loop: asyncio.AbstractEventLoop) -> None:
        while self._terminal.is_alive() and not self._stopped.is_set():
            await asyncio.sleep(0.1)
        self._stopped.set()

    @property
    def websocket(self) -> WebSocket | None:
        return self._ws

    async def write(self, data: bytes | str) -> None:
        """Write to PTY if bytes, send to WebSocket if str."""
        if isinstance(data, bytes):
            await self._terminal.write(data)
        else:
            if self._ws:
                await self._ws.send_text(data)

    async def _auto_send(self, data: bytes) -> None:
        await asyncio.sleep(0.5)
        await self._terminal.write(data.rstrip(b"\r\n") + b"\r")
