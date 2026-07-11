from app.terminal.terminal import Terminal


class TerminalWriteAction:
    def __init__(self, session_id: str | None, message: str):
        self.session_id = session_id
        self.message = message

    @staticmethod
    def prepare(session_id: str | None, message: str) -> "TerminalWriteAction":
        return TerminalWriteAction(session_id, message)

    async def execute(self) -> bool:
        terminal = self.resolve_terminal()

        if terminal:
            await terminal.send(self.message)
            return True

        return False

    def resolve_terminal(self) -> Terminal | None:
        from fastapi_startkit.application import app

        from app.terminal.connection_manager import ConnectionManager
        from app.terminal.manager import TerminalManager

        connection_manager: ConnectionManager = app().make("connections")
        ws_terminal = connection_manager.get(self.session_id) if self.session_id else None

        if ws_terminal:
            return ws_terminal.terminal

        terminal_manager: TerminalManager = app().make("terminal")
        terminal = terminal_manager.find(self.session_id) if self.session_id else None

        return terminal
