import uuid
from fastapi_startkit.logging import Logger

from app.terminal.terminal import Terminal


class TerminalManager:
    def __init__(self):
        self._sessions: dict[str, Terminal] = {}

    def create(
        self,
        shell: str | None = None,
        cwd: str | None = None,
        cols: int = 80,
        rows: int = 24,
        env: dict | None = None,
        session_id: str | None = None,
    ) -> str:
        pty = Terminal(shell=shell, cwd=cwd, cols=cols, rows=rows, env=env)
        pty.start()

        sid = session_id if session_id is not None else str(uuid.uuid4())
        self._sessions[sid] = pty

        return sid

    def get(self, session_id: str) -> Terminal:
        return self._sessions[session_id]

    def find(self, session_id: str) -> Terminal | None:
        return self._sessions.get(session_id)

    def write(self, session_id: str, data: bytes | str) -> None:
        if isinstance(data, str):
            data = data.encode()
        self._sessions[session_id].write(data)

    async def write_input(self, session_id: str, data: bytes | str) -> None:
        if isinstance(data, str):
            data = data.encode()
        await self._sessions[session_id].write_input(data)

    def resize(self, session_id: str, cols: int, rows: int):
        self._sessions[session_id].resize(cols, rows)

    def close(self, session_id: str):
        pty = self._sessions.pop(session_id, None)
        if pty:
            pty.stop()

    def shutdown(self):
        Logger.info("Shutting down terminal manager")
        for pty in self._sessions.values():
            pty.stop()
        self._sessions.clear()
