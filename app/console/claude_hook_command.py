import asyncio
import os

from fastapi_startkit.console.command import Command


class ClaudeHookCommand(Command):
    """
    Re-sync the Claude Stop hook + MCP entry into the app's own .claude/settings.json
    and every project's, from KEERA_APP_URL.

    claude:hook
    """

    name = "claude:hook"
    description = "Re-sync .claude/settings.json (Claude hooks) into the app and every project from KEERA_APP_URL."

    def handle(self):
        return asyncio.run(self.handle_async())

    async def handle_async(self):
        from app.actions.claude_hook_action import ClaudeHookAction
        from app.models.Project import Project
        from app.utils.hook_setup import BASE_URL, app_base_dir

        self.line(f"<info>Syncing .claude/settings.json from</info> {BASE_URL}")

        # The keera-agent app's own directory — this is what dist/build.sh relies on.
        ClaudeHookAction.prepare(app_base_dir()).execute()

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
