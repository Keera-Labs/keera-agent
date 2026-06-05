from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.terminal.websocket_terminal import WebsocketTerminal


class ConnectionManager:
    def __init__(self):
        self._connections: dict[str, WebsocketTerminal] = {}
        self._cwd_index: dict[str, str] = {}  # conn_key → cwd

    def set(self, key: str, bridge: WebsocketTerminal, cwd: str | None = None) -> None:
        self._connections[key] = bridge
        if cwd:
            self._cwd_index[key] = cwd

    def get(self, key: str) -> WebsocketTerminal | None:
        return self._connections.get(key)

    def remove(self, key: str) -> None:
        self._connections.pop(key, None)
        self._cwd_index.pop(key, None)

    def find_by_cwd(self, cwd: str) -> WebsocketTerminal | None:
        for key, c in self._cwd_index.items():
            if c == cwd:
                return self._connections.get(key)
        return None

    def all_for_cwd(self, cwd: str) -> list[WebsocketTerminal]:
        return [
            self._connections[key]
            for key, c in self._cwd_index.items()
            if c == cwd and key in self._connections
        ]

    def all(self) -> list[WebsocketTerminal]:
        return list(self._connections.values())

    async def shutdown(self) -> None:
        for bridge in list(self._connections.values()):
            try:
                await bridge.websocket.close()
            except Exception:
                pass
        self._connections.clear()
        self._cwd_index.clear()
