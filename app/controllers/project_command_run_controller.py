from fastapi import WebSocket
from fastapi.responses import JSONResponse, Response
from fastapi_startkit.application import app
from fastapi_startkit.jsonapi import ResourceCollection

from app.models.Project import Project
from app.requests.command_request import ProjectCommandRunStoreRequest
from app.resources.command_run_resource import CommandRunResource
from app.services.command_workspace import CommandWorkspace
from app.services.process import CommandError
from app.terminal.command_runs import CommandRun, CommandRunRegistry, CommandRunSpec
from app.terminal.websocket_terminal import WebsocketTerminal
from app.utils.git_responses import git_error_status


def _runs() -> CommandRunRegistry:
    return app().make("command_runs")


def _project_run(project: Project, run_id: str) -> CommandRun | None:
    run = _runs().get(run_id)
    return run if run is not None and run.project_id == project.id else None


async def _root(project: Project) -> str:
    return (await CommandWorkspace.resolve(project, None)).key


async def index(project_id: int):
    project = await Project.find_or_fail(project_id)
    root = await _root(project)
    return ResourceCollection(
        [CommandRunResource(run, root) for run in _runs().for_project(project.id)],
        primary_type=CommandRunResource.type,
    )


async def store(body: ProjectCommandRunStoreRequest, project_id: int):
    project = await Project.find_or_fail(project_id)
    try:
        workspace = await CommandWorkspace.resolve(project, body.worktree)
    except CommandError as e:
        return JSONResponse({"error": e.message}, status_code=git_error_status(e))

    spec = CommandRunSpec(project_id=project.id, label=body.command, command=body.command)
    run = await _runs().start(spec, workspace.key, await workspace.env())
    return CommandRunResource(run, str(workspace.root))


async def destroy(project_id: int, run_id: str):
    project = await Project.find_or_fail(project_id)
    run = _project_run(project, run_id)
    if run is None:
        return JSONResponse({"error": "Command run not found."}, status_code=404)

    await _runs().stop_run(run)
    return Response(status_code=204)


async def attach(websocket: WebSocket, project: str, run_id: str):
    await websocket.accept()

    project_record = await Project.where("slug", project).first()
    run = _project_run(project_record, run_id) if project_record is not None else None
    if run is None:
        await websocket.close(code=1008, reason="Command run not found")
        return

    bridge = WebsocketTerminal(websocket, run.terminal, replay_history=True, close_on_exit=True)
    await bridge.run(stop_on_disconnect=False)
