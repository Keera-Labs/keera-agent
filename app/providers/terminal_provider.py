from fastapi_startkit.support import Provider

from app.terminal.connection_manager import ConnectionManager
from app.terminal.manager import TerminalManager


class TerminalProvider(Provider):
    def register(self):
        self.app.bind("terminal", TerminalManager())
        self.app.bind("connections", ConnectionManager())

    def boot(self):
        terminal_manager = self.app.make("terminal")
        conn_manager = self.app.make("connections")
        self.app.fastapi.add_event_handler("shutdown", terminal_manager.shutdown)
        self.app.fastapi.add_event_handler("shutdown", conn_manager.shutdown)
