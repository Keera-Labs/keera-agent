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
        from app.console.seed_templates_command import SeedTemplatesCommand
        self.app.fastapi.include_router(router.router)
        ensure_hooks()
        self.commands([QueueWorkCommand, SeedTemplatesCommand])

        async def on_startup():
            """Ensure built-in templates are seeded and each project has a default PM agent."""
            from app.models.Project import Project
            from app.models.Agent import Agent
            from app.actions.seed_builtin_templates_action import SeedBuiltinTemplatesAction
            from app.controllers.agent_trigger_controller import _prune_all_orphaned_worktrees
            await SeedBuiltinTemplatesAction().execute()

            # Prune git worktrees left behind by previously deleted agents
            await _prune_all_orphaned_worktrees()

            # Ensure each project has a default PM agent
            projects = await Project.all()
            for project in projects:
                existing = await Agent.where("project_id", project.id).first()
                if not existing:
                    from app.utils.system_prompts import default_system_prompt
                    import json as _json
                    await Agent.create({
                        "project_id": project.id,
                        "name": "PM",
                        "agent_type": "pm",
                        "description": "Project manager agent that coordinates work across the team.",
                        "model": "claude-opus-4-8",
                        "system_prompt": default_system_prompt("pm"),
                        "flags": _json.dumps({}),
                        "status": "idle",
                        "has_session": False,
                        "dangerously_skip_permissions": True,
                        "plan_mode": True,
                    })

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
