from fastapi_startkit.providers import Provider

from app.terminal.manager import TerminalManager


class TerminalProvider(Provider):
    def register(self):
        terminal_manager = TerminalManager()
        self.app.bind("terminal", terminal_manager)

    def boot(self):
        terminal_manager = self.app.make("terminal")
        self.app.fastapi.add_event_handler("shutdown", terminal_manager.shutdown)
