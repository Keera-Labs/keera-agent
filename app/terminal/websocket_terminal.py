import asyncio
import json
from collections.abc import Awaitable, Callable

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.terminal.terminal import Terminal
from app.terminal.terminal_queries import is_terminal_response

# Fallback for a client that never acknowledges the replay.
REPLAY_ACK_TIMEOUT = 5.0


class WebsocketTerminal:
    def __init__(
        self,
        websocket: WebSocket | None,
        terminal: Terminal,
        on_output: Callable[[bytes], Awaitable[None]] | None = None,
        on_restart: Callable[[], Awaitable[object]] | None = None,
        replay_history: bool = False,
        close_on_exit: bool = False,
    ):
        self._ws = websocket
        self._close_on_exit = close_on_exit
        self._terminal = terminal
        self._on_output = on_output
        self._on_restart = on_restart
        # A client attaching to a running PTY starts from a blank xterm: replay
        # recent output, then have the CLI repaint once the client's size is known.
        self._replay_history = replay_history
        self._needs_redraw = replay_history
        # Until the client confirms it has rendered the replay, input that is only
        # terminal responses is xterm answering replayed queries, not the user.
        self._replay_deadline: float | None = None
        self._restart_task: asyncio.Task | None = None
        self._redraw_task: asyncio.Task | None = None
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
        # Taken in the same step as subscribing, so the replay and the live chunks
        # after it neither overlap nor leave a gap.
        history = self._terminal.history() if self._replay_history else b""
        queue = self._terminal.subscribe()
        try:
            if history and self._ws is not None:
                self._replay_deadline = loop.time() + REPLAY_ACK_TIMEOUT
                await self._ws.send_text(json.dumps({"type": "replay_start"}))
                await self._ws.send_bytes(history)
                await self._ws.send_text(json.dumps({"type": "replay_end"}))
            while not self._stopped.is_set():
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=0.1)
                    if self._ws is not None:
                        await self._ws.send_bytes(data)
                    if self._on_output:
                        await self._on_output(data)
                except asyncio.TimeoutError:
                    continue
            await self._send_pending(queue)
            if self._close_on_exit and not self._terminal.is_alive():
                await self._close_websocket()
        finally:
            self._terminal.unsubscribe(queue)

    async def _send_pending(self, queue: "asyncio.Queue[bytes]") -> None:
        while self._ws is not None and not queue.empty():
            await self._ws.send_bytes(queue.get_nowait())

    async def _close_websocket(self) -> None:
        if self._ws is not None and self._ws.client_state == WebSocketState.CONNECTED:
            await self._ws.close(code=1000, reason="Process exited")

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
                        elif isinstance(parsed, dict) and parsed.get("type") == "replay_done":
                            self._replay_deadline = None
                        else:
                            # Text = raw keyboard from term.onData → no modification
                            await self._terminal.write(text.encode())
                    except (json.JSONDecodeError, ValueError):
                        if not self._is_replay_response(text):
                            await self._terminal.write(text.encode())
            except (WebSocketDisconnect, Exception):
                break
        self._stopped.set()

    def _is_replay_response(self, text: str) -> bool:
        if self._replay_deadline is None:
            return False
        if asyncio.get_running_loop().time() > self._replay_deadline:
            self._replay_deadline = None
            return False
        return is_terminal_response(text.encode())

    def _resize(self, message: dict) -> None:
        before = self._terminal.size
        self._terminal.set_client_size(
            self,
            int(message["cols"]),
            int(message["rows"]),
            visible=bool(message.get("visible", True)),
        )
        # A size change already makes the CLI repaint; an unchanged size needs a
        # nudge, since a replayed byte stream of a cursor-addressed TUI captured at
        # another size or cut mid-screen can land in the wrong cells.
        if self._needs_redraw:
            self._needs_redraw = False
            if self._terminal.size == before:
                self._redraw_task = asyncio.create_task(self._terminal.force_redraw())

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
