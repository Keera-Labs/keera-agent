import asyncio
from fastapi_startkit.console.command import Command


class SeedTemplatesCommand(Command):
    """
    Update built-in agent templates from app/constant/templates.py.

    templates:update
    """

    name = "templates:update"
    description = "Re-seed built-in agent templates from the constants file."

    def handle(self):
        return asyncio.run(self.handle_async())

    async def handle_async(self):
        from app.actions.seed_builtin_templates_action import SeedBuiltinTemplatesAction
        self.line("<info>Updating built-in templates...</info>")
        await SeedBuiltinTemplatesAction().execute()
        self.line("<info>Done.</info>")
