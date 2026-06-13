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
        reverb_server = self.app.make('reverb.server')
        self.app.fastapi.mount('/reverb', reverb_server.as_starlette_app('local'))
        ensure_hooks()
        self.commands([QueueWorkCommand, SeedTemplatesCommand])

        async def on_startup():
            """Sync Claude settings for all projects and ensure each has a default PM agent."""
            import os
            from app.models.Project import Project
            from app.models.Agent import Agent
            from app.utils.hook_setup import ensure_claude_settings, BASE_URL
            from app.actions.seed_builtin_templates_action import SeedBuiltinTemplatesAction
            from app.controllers.agent_trigger_controller import _prune_all_orphaned_worktrees
            await SeedBuiltinTemplatesAction().execute()

            # Prune git worktrees left behind by previously deleted agents
            await _prune_all_orphaned_worktrees()

            projects = await Project.all()
            for project in projects:
                expanded = os.path.expanduser(project.path)
                if os.path.isdir(expanded):
                    # Re-sync MCP + hooks for every project directory
                    ensure_claude_settings(expanded, BASE_URL)

                    # Also re-sync any existing agent subdirectories
                    agents_dir = os.path.join(expanded, '.keera-agents')
                    if os.path.isdir(agents_dir):
                        for entry in os.scandir(agents_dir):
                            if entry.is_dir():
                                ensure_claude_settings(entry.path, BASE_URL, project_path=expanded)

                # Ensure default PM agent exists
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
