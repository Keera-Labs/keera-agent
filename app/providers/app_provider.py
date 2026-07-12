from fastapi.templating import Jinja2Templates
from fastapi_startkit.providers import Provider


class AppProvider(Provider):
    provider_key = "keera"

    def register(self) -> None:
        templates = Jinja2Templates(directory=str(self.app.base_path / "resources" / "templates"))
        self.app.bind("templates", templates)

    def boot(self) -> None:
        from app.console.claude_hook_command import ClaudeHookCommand
        from app.console.mcp_sync_command import McpSyncCommand
        from app.console.queue_work_command import QueueWorkCommand
        from app.console.seed_templates_command import SeedTemplatesCommand
        from app.exceptions.handlers import register_exception_handlers
        from routes.api import router as api_router
        from routes.web import router as web_router

        self.app.fastapi.include_router(web_router.router)
        self.app.fastapi.include_router(api_router.router)

        register_exception_handlers(self.app)
        self.commands([QueueWorkCommand, SeedTemplatesCommand, McpSyncCommand, ClaudeHookCommand])

        async def on_startup():
            """Ensure built-in templates are seeded."""
            from app.actions.seed_builtin_templates_action import SeedBuiltinTemplatesAction

            await SeedBuiltinTemplatesAction().execute()

        self.app.fastapi.add_event_handler("startup", on_startup)

        async def on_shutdown():
            import os
            import signal

            from app.controllers.command_controller import _processes

            for proc in list(_processes.values()):
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass

        self.app.fastapi.add_event_handler("shutdown", on_shutdown)
