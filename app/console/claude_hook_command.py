import os

from cleo.helpers import option
from fastapi_startkit.console.command import Command


class ClaudeHookCommand(Command):
    """
    Write the Claude Stop hook + MCP entry into a .claude/settings.json from env.

    claude:hook
    """

    name = "claude:hook"
    description = "Write Claude hooks into .claude/settings.json from KEERA_APP_URL."
    options = [
        option(
            "dir",
            "d",
            "Target directory whose .claude/settings.json to write (default: app root).",
            flag=False,
            default=None,
        )
    ]

    def handle(self):
        from app.utils.hook_setup import BASE_URL, app_base_dir, ensure_claude_settings

        directory = self.option("dir") or app_base_dir()
        directory = os.path.abspath(os.path.expanduser(directory))

        self.line(
            f"<info>Writing Claude hooks into</info> {directory}/.claude/settings.json "
            f"<info>from</info> {BASE_URL}"
        )
        if ensure_claude_settings(directory, BASE_URL):
            self.line("<info>updated.</info>")
        else:
            self.line("<comment>already current.</comment>")
