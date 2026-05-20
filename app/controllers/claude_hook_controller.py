import json

from fastapi import Request
from fastapi.responses import JSONResponse

from app.controllers.terminal_controller import connections
from app.models.Project import Project


async def claude_stopped(request: Request):
    """
    Receives the Claude Code Stop hook POST.
    Payload includes: session_id, cwd, hook_event_name, stop_hook_active, etc.
    We use `cwd` to find the active WebSocket and notify the frontend.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    cwd = body.get('cwd', '')

    if not cwd:
        return JSONResponse({}, status_code=200)

    # Find the project by path and mark as idle
    project = await Project.where('path', cwd).first()
    if project:
        await Project.where('id', project.id).update({'claude_status': 'idle'})

    # Notify the connected frontend WebSocket for this project
    ws = connections.get(cwd)
    if ws:
        try:
            await ws.send_text(json.dumps({'type': 'claude_stopped', 'cwd': cwd}))
        except Exception:
            pass

    return JSONResponse({}, status_code=200)
