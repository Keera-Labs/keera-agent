import uuid

from fastapi import WebSocket
from fastapi_startkit.application import app

from app.models.Project import Project
from app.services.command_workspace import CommandWorkspace
from app.services.process import CommandError
from app.terminal.manager import TerminalManager
from app.terminal.websocket_terminal import WebsocketTerminal
from app.utils.process_env import user_env

LOGIN_FLAG = "-l"


async def attach(websocket: WebSocket, project: str, worktree: str | None = None):
    await websocket.accept()

    project_record = await Project.where("slug", project).first()
    if project_record is None:
        await websocket.close(code=1008, reason="Project not found")
        return

    try:
        workspace = await CommandWorkspace.resolve(project_record, worktree)
    except CommandError:
        await websocket.close(code=1008, reason="Unknown worktree")
        return

    if not workspace.cwd.is_dir():
        await websocket.close(code=1008, reason="Directory not found")
        return

    env = user_env()
    terminals: TerminalManager = app().make("terminal")
    session_id = terminals.create(
        shell=env.get("SHELL"),
        cwd=str(workspace.cwd),
        env=env,
        args=[LOGIN_FLAG],
        session_id=f"shell:{uuid.uuid4()}",
    )
    bridge = WebsocketTerminal(websocket, terminals.get(session_id), close_on_exit=True)
    try:
        await bridge.run()
    finally:
        await terminals.close(session_id)
