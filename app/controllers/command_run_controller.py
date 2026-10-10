from typing import Annotated

from fastapi import Query, WebSocket
from fastapi.responses import Response
from fastapi_startkit.application import app

from app.models.Command import Command
from app.models.Project import Project
from app.requests.command_request import CommandRunStoreRequest
from app.requests.git_request import GitWorktreeQuery
from app.resources.command_run_resource import CommandRunResource
from app.services.command_workspace import CommandWorkspace
from app.services.process import CommandError
from app.terminal.command_runs import CommandRunRegistry
from app.terminal.websocket_terminal import WebsocketTerminal
from app.utils.git_responses import git_error_response


def _runs() -> CommandRunRegistry:
    return app().make("command_runs")


async def _workspace_for(command: Command, worktree: str | None) -> CommandWorkspace:
    return await CommandWorkspace.resolve(await Project.find_or_fail(command.project_id), worktree)


async def index(project_id: int):
    command_ids = [command.id for command in await Command.where("project_id", project_id).get()]
    return CommandRunResource.collection(_runs().for_commands(command_ids))


async def store(body: CommandRunStoreRequest, command_id: int):
    command = await Command.find_or_fail(command_id)
    try:
        workspace = await _workspace_for(command, body.worktree)
    except CommandError as e:
        return git_error_response(e)

    run = await _runs().start(command.id, command.command, workspace.key, await workspace.env())
    return CommandRunResource(run)


async def destroy(command_id: int, query: Annotated[GitWorktreeQuery, Query()]):
    command = await Command.find_or_fail(command_id)
    try:
        workspace = await _workspace_for(command, query.worktree)
    except CommandError as e:
        return git_error_response(e)

    await _runs().stop(command.id, workspace.key)
    return Response(status_code=204)


async def attach(websocket: WebSocket, project: str, command_id: int, worktree: str | None = None):
    await websocket.accept()

    command = await Command.find(command_id)
    project_record = await Project.where("slug", project).first()
    if command is None or project_record is None or command.project_id != project_record.id:
        await websocket.close(code=1008, reason="Command not found")
        return

    try:
        workspace = await CommandWorkspace.resolve(project_record, worktree)
    except CommandError:
        await websocket.close(code=1008, reason="Unknown worktree")
        return

    run = _runs().find(command.id, workspace.key)
    if run is None:
        await websocket.close(code=1000, reason="Command is not running")
        return

    bridge = WebsocketTerminal(websocket, run.terminal, replay_history=True, close_on_exit=True)
    await bridge.run(stop_on_disconnect=False)
