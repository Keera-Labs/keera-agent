from fastapi.templating import Jinja2Templates
from fastapi_startkit.support import Provider


class AppProvider(Provider):
    provider_key = "keera"

    def register(self) -> None:
        templates = Jinja2Templates(directory=str(self.app.base_path / "resources" / "templates"))
        self.app.bind("templates", templates)

        from fastapi_startkit import Config

        from app.services.log_maintenance import quiet_noisy_loggers

        quiet_noisy_loggers(Config.get("logging.library_level", "warning"))

    def boot(self) -> None:
        from app.console.claude_hook_command import ClaudeHookCommand
        from app.console.mcp_sync_command import McpSyncCommand
        from app.console.queue_work_command import QueueWorkCommand
        from app.console.seed_templates_command import SeedTemplatesCommand
        from app.console.worktrees_prune_command import WorktreesPruneCommand
        from app.exceptions.handlers import register_exception_handlers
        from routes.api import router as api_router
        from routes.web import router as web_router

        self.app.fastapi.include_router(web_router.router)
        self.app.fastapi.include_router(api_router.router)

        register_exception_handlers(self.app)
        self.commands(
            [
                QueueWorkCommand,
                SeedTemplatesCommand,
                McpSyncCommand,
                ClaudeHookCommand,
                WorktreesPruneCommand,
            ]
        )

        async def on_startup():
            """Ensure built-in templates are seeded."""
            from app.actions.seed_builtin_templates_action import SeedBuiltinTemplatesAction

            await SeedBuiltinTemplatesAction().execute()

            from app.actions.statusline_settings_write_action import StatuslineSettingsWriteAction

            try:
                StatuslineSettingsWriteAction().execute()
            except OSError:
                pass  # Agents just start without Keera's statusline.

            import asyncio

            from fastapi_startkit import Config

            from app.services.log_maintenance import prune_daily_logs_forever

            # Keep a reference so the task is not garbage-collected mid-sleep.
            self.log_pruner = asyncio.create_task(
                prune_daily_logs_forever(
                    Config.get("logging.channels.daily.path", "storage/logs"),
                    int(Config.get("logging.retention_days", 14)),
                )
            )

            # Resume PM check-in schedulers that were left enabled so their state
            # survives a server restart, not just a browser reload.
            try:
                from app import checkin_scheduler
                from app.models.Agent import Agent

                pms = await (
                    Agent.where("agent_type", "pm")
                    .where("checkin_enabled", True)
                    .where_null("deleted_at")
                    .get()
                )
                for pm in pms:
                    checkin_scheduler.start(pm.project_id, int(pm.checkin_interval_minutes or 5))
            except Exception:
                pass

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
