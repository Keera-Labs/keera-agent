import asyncio
import uuid
from pathlib import Path

from fastapi_startkit.logging import Logger

from app.terminal.terminal import Terminal

SHELL_SESSION_PREFIX = "shell:"


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
        args: list[str] | None = None,
    ) -> str:
        pty = Terminal(shell=shell, cwd=cwd, cols=cols, rows=rows, env=env, args=args)
        pty.start()

        sid = session_id if session_id is not None else str(uuid.uuid4())
        self._sessions[sid] = pty

        return sid

    def get(self, session_id: str) -> Terminal:
        return self._sessions[session_id]

    def find(self, session_id: str) -> Terminal | None:
        return self._sessions.get(session_id)

    async def write(self, session_id: str, data: bytes | str) -> None:
        if isinstance(data, str):
            data = data.encode()
        await self._sessions[session_id].write(data)

    def resize(self, session_id: str, cols: int, rows: int):
        self._sessions[session_id].resize(cols, rows)

    async def close(self, session_id: str):
        pty = self._sessions.pop(session_id, None)
        if pty:
            await pty.aclose()

    async def close_within(self, directory: str, prefix: str) -> None:
        root = Path(directory).resolve()
        doomed = [
            sid
            for sid, pty in self._sessions.items()
            if sid.startswith(prefix) and Path(pty.cwd).resolve().is_relative_to(root)
        ]
        await asyncio.gather(*(self.close(sid) for sid in doomed))

    async def shutdown(self):
        Logger.info("Shutting down terminal manager")
        ptys = list(self._sessions.values())
        self._sessions.clear()
        await asyncio.gather(*(pty.aclose() for pty in ptys))
