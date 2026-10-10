from typing import Annotated

from fastapi import Query
from fastapi.responses import Response
from fastapi_startkit.application import app
from fastapi_startkit.jsonapi import ResourceCollection

from app.models.Command import Command
from app.models.Project import Project
from app.requests.command_request import CommandStoreRequest, CommandUpdateRequest
from app.requests.git_request import GitWorktreeQuery
from app.resources.command_resource import CommandResource
from app.services.command_workspace import CommandWorkspace
from app.services.process import CommandError
from app.terminal.command_runs import CommandRunRegistry
from app.utils.git_responses import git_error_response


def _runs() -> CommandRunRegistry:
    return app().make("command_runs")


async def index(project_id: int, query: Annotated[GitWorktreeQuery, Query()]):
    project = await Project.find_or_fail(project_id)
    try:
        workspace = await CommandWorkspace.resolve(project, query.worktree)
    except CommandError as e:
        return git_error_response(e)

    commands = await Command.where("project_id", project_id).order_by("id").get()
    return ResourceCollection(
        [CommandResource(command, _runs().find(command.id, workspace.key)) for command in commands],
        primary_type=CommandResource.type,
    )


async def store(body: CommandStoreRequest, project_id: int) -> CommandResource:
    await Project.find_or_fail(project_id)
    command = await Command.create({**body.model_dump(), "project_id": project_id})
    return CommandResource(command)


async def update(body: CommandUpdateRequest, command_id: int) -> CommandResource:
    command = await Command.find_or_fail(command_id)
    await command.update(body.model_dump(exclude_unset=True))
    return CommandResource(command)


async def destroy(command_id: int):
    await Command.find_or_fail(command_id)
    await _runs().forget_command(command_id)
    await Command.where("id", command_id).delete()
    return Response(status_code=204)
