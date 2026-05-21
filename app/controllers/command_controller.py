import os
import signal
import subprocess
import threading
from collections import deque

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Command import Command

# In-process registry: command_id → Popen
_processes: dict[int, subprocess.Popen] = {}
# Recent output buffer: command_id → deque of lines (capped at 200)
_output: dict[int, deque] = {}
_OUTPUT_LIMIT = 200


def _serialize(c: Command) -> dict:
    return {
        "id": c.id,
        "project_id": c.project_id,
        "label": c.label,
        "command": c.command,
        "status": c.status,
        "pid": c.pid,
    }


def _stream_output(cmd_id: int, proc: subprocess.Popen):
    """Read stdout+stderr in a background thread and buffer lines."""
    buf = _output.setdefault(cmd_id, deque(maxlen=_OUTPUT_LIMIT))
    try:
        for line in proc.stdout:  # type: ignore[union-attr]
            buf.append(line.rstrip("\n"))
    except Exception:
        pass


async def index(request: Request, project_id: int):
    commands = await Command.where("project_id", project_id).get()
    # Reconcile DB status with live processes
    result = []
    for c in commands:
        if c.status == "running" and c.id not in _processes:
            # Process died while server was down — mark stopped
            c.status = "stopped"
            c.pid = None
            await c.save()
        result.append(_serialize(c))
    return JSONResponse(result)


async def store(request: Request, project_id: int):
    body = await request.json()
    label = (body.get("label") or "").strip()
    command = (body.get("command") or "").strip()
    if not label or not command:
        return JSONResponse({"error": "label and command are required"}, status_code=422)

    cmd = await Command.create({
        "project_id": project_id,
        "label": label,
        "command": command,
        "status": "stopped",
    })
    return JSONResponse(_serialize(cmd), status_code=201)


async def run(request: Request, command_id: int):
    cmd = await Command.find(command_id)
    if not cmd:
        return JSONResponse({"error": "not found"}, status_code=404)

    if cmd.status == "running" and command_id in _processes:
        return JSONResponse({"error": "already running"}, status_code=409)

    try:
        proc = subprocess.Popen(
            cmd.command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            preexec_fn=os.setsid,  # own process group so we can kill the whole tree
        )
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)

    _processes[command_id] = proc
    _output[command_id] = deque(maxlen=_OUTPUT_LIMIT)
    threading.Thread(target=_stream_output, args=(command_id, proc), daemon=True).start()

    cmd.status = "running"
    cmd.pid = proc.pid
    await cmd.save()
    return JSONResponse(_serialize(cmd))


async def stop(request: Request, command_id: int):
    cmd = await Command.find(command_id)
    if not cmd:
        return JSONResponse({"error": "not found"}, status_code=404)

    proc = _processes.pop(command_id, None)
    if proc is not None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    cmd.status = "stopped"
    cmd.pid = None
    await cmd.save()
    return JSONResponse(_serialize(cmd))


async def output(request: Request, command_id: int):
    lines = list(_output.get(command_id, []))
    return JSONResponse({"lines": lines})


async def destroy(request: Request, command_id: int):
    cmd = await Command.find(command_id)
    if not cmd:
        return JSONResponse({"error": "not found"}, status_code=404)

    # Stop first if running
    proc = _processes.pop(command_id, None)
    if proc is not None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    _output.pop(command_id, None)
    await cmd.delete()
    return JSONResponse({}, status_code=204)
