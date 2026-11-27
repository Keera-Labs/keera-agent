from fastapi_startkit.application import app

from app.models.Command import Command
from app.services.command_workspace import CommandWorkspace
from app.terminal.command_runs import CommandRun, CommandRunSpec


async def start_command_run(command: Command, workspace: CommandWorkspace) -> CommandRun:
    spec = CommandRunSpec(
        project_id=command.project_id,
        label=command.label,
        command=command.command,
        command_id=command.id,
    )
    return await app().make("command_runs").start(spec, workspace.key, await workspace.env())
