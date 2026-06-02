from fastapi.templating import Jinja2Templates
from fastapi_startkit.providers import Provider


class AppProvider(Provider):
    provider_key = "keera"

    def register(self) -> None:
        templates = Jinja2Templates(directory=str(self.app.base_path / "templates"))
        self.app.bind("templates", templates)

    def boot(self) -> None:
        from routes.web import router
        from app.utils.hook_setup import ensure_hooks
        from app.console.queue_work_command import QueueWorkCommand
        self.app.fastapi.include_router(router.router)
        ensure_hooks()
        self.commands([QueueWorkCommand])

        async def on_shutdown():
            import os
            import signal
            from app.controllers.terminal_controller import _pty_procs
            from app.controllers.command_controller import _processes
            for proc in list(_pty_procs.values()):
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
            for proc in list(_processes.values()):
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass

        self.app.fastapi.add_event_handler("shutdown", on_shutdown)
