import uuid
from fastapi_startkit.logging import Logger
from typing import Dict

from app.terminal.terminal import Terminal


class TerminalManager:
    def __init__(self):
        self.connections: Dict[str, Terminal] = {}

    def create(
        self,
        shell: str | None = None,
        cwd: str | None = None,
        cols: int = 80,
        rows: int = 24,
        env: dict | None = None,
    ) -> str:
        pty = Terminal(shell=shell, cwd=cwd, cols=cols, rows=rows, env=env)
        pty.start()

        session_id = str(uuid.uuid4())
        self.connections[session_id] = pty

        return session_id

    def get(self, session_id: str) -> Terminal:
        return self.connections[session_id]

    def write(self, session_id: str, data: bytes):
        self.connections[session_id].write(data)

    def resize(self, session_id: str, cols: int, rows: int):
        self.connections[session_id].resize(cols, rows)

    def close(self, session_id: str):
        pty = self.connections.pop(session_id, None)
        if pty:
            pty.stop()

    def shutdown(self):
        Logger.info("Shutting down terminal manager")
        for pty in self.connections.values():
            pty.stop()
        self.connections.clear()
