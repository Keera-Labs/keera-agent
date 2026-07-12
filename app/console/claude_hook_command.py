import asyncio
import os

from fastapi_startkit.console.command import Command


class ClaudeHookCommand(Command):
    """
    Re-sync the Claude hooks into the app's own .claude/settings.json and every
    project's, from the configured app_url.

    claude:hook
    """

    name = "claude:hook"
    description = "Re-sync Claude hooks in .claude/settings.json into the app and every project."

    def handle(self):
        return asyncio.run(self.handle_async())

    async def handle_async(self):
        from fastapi_startkit import Config
        from fastapi_startkit.application import app

        from app.actions.claude_hook_action import ClaudeHookAction
        from app.models.Project import Project

        self.line(
            f"<info>Syncing .claude/settings.json from</info> {Config.get('fastapi.app_url')}"
        )

        # The keera-agent app's own directory — this is what dist/build.sh relies on.
        ClaudeHookAction.prepare(str(app().base_path)).execute()

        projects = await Project.all()
        updated = skipped = unchanged = 0
        for project in projects:
            expanded = os.path.expanduser(project.path)
            if not os.path.isdir(expanded):
                self.line(
                    f"<comment>skip</comment> {project.name}: directory not found ({expanded})"
                )
                skipped += 1
                continue
            if ClaudeHookAction.prepare(expanded).execute():
                self.line(f"<info>updated</info> {project.name} ({expanded})")
                updated += 1
            else:
                unchanged += 1

        self.line(
            f"<info>Done.</info> {updated} updated, {unchanged} already current, {skipped} skipped."
        )
