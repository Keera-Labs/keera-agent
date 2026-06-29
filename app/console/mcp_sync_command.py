import asyncio
import os

from fastapi_startkit.console.command import Command


class McpSyncCommand(Command):
    """
    Re-sync the keera-agent-mcp entry in every project's .mcp.json.

    mcp:sync
    """

    name = "mcp:sync"
    description = "Re-sync .mcp.json (keera-agent-mcp) into every project root from KEERA_APP_URL."

    def handle(self):
        return asyncio.run(self.handle_async())

    async def handle_async(self):
        from app.models.Project import Project
        from app.utils.hook_setup import ensure_mcp_json, BASE_URL

        self.line(f"<info>Syncing .mcp.json from</info> {BASE_URL}")

        projects = await Project.all()
        updated = skipped = unchanged = 0
        for project in projects:
            expanded = os.path.expanduser(project.path)
            if not os.path.isdir(expanded):
                self.line(f"<comment>skip</comment> {project.name}: directory not found ({expanded})")
                skipped += 1
                continue
            if ensure_mcp_json(expanded, BASE_URL):
                self.line(f"<info>updated</info> {project.name} ({expanded})")
                updated += 1
            else:
                unchanged += 1

        self.line(f"<info>Done.</info> {updated} updated, {unchanged} already current, {skipped} skipped.")
