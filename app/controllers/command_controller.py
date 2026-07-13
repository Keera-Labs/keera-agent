import asyncio
import fcntl
import json
import os
import pty
import signal
import struct
import subprocess
import termios
import threading
import time
from collections import deque
from datetime import datetime, timezone

from fastapi import Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response

from app.models.Command import Command
from app.models.Project import Project

# In-process registry: command_id → Popen
_processes: dict[int, subprocess.Popen] = {}
# Recent output buffer: command_id → deque of lines (capped at 200)
_output: dict[int, deque] = {}
_OUTPUT_LIMIT = 200

# In-memory run history: command_id → list of run dicts (last 20)
_runs: dict[int, deque] = {}
_RUNS_LIMIT = 20


def _serialize(c: Command) -> dict:
    return {
        "id": c.id,
        "project_id": c.project_id,
        "label": c.label,
        "command": c.command,
        "description": getattr(c, "description", None) or "",
        "category": getattr(c, "category", None) or "General",
        "shortcut": getattr(c, "shortcut", None) or "",
        "status": c.status,
        "pid": c.pid,
    }


def _serialize_run(r: dict) -> dict:
    return r


def _stream_output(cmd_id: int, proc: subprocess.Popen, start_ts: float):
    """Read stdout+stderr in a background thread, buffer lines, record run on exit."""
    buf = _output.setdefault(cmd_id, deque(maxlen=_OUTPUT_LIMIT))
    try:
        for line in proc.stdout:  # type: ignore[union-attr]
            buf.append(line.rstrip("\n"))
    except Exception:
        pass

    # Wait for process to fully exit and record run
    try:
        proc.wait(timeout=5)
    except Exception:
        pass

    exit_code = proc.returncode if proc.returncode is not None else -1
    duration_ms = int((time.monotonic() - start_ts) * 1000)

    run_record = {
        "exit_code": exit_code,
        "duration_ms": duration_ms,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    runs_buf = _runs.setdefault(cmd_id, deque(maxlen=_RUNS_LIMIT))
    runs_buf.appendleft(run_record)


async def commands_for_project(project_id: int) -> list[dict]:
    """Serialized commands for a project, reconciling stale 'running' rows.

    A command left "running" with no live process (server restarted mid-run) is
    corrected to "stopped" so the UI never shows a phantom process. Shared by the
    JSON `index` endpoint and the Configurations page controller.
    """
    commands = await Command.where("project_id", project_id).get()
    result = []
    for c in commands:
        if c.status == "running" and c.id not in _processes:
            c.status = "stopped"
            c.pid = None
            await c.save()
        result.append(_serialize(c))
    return result


async def index(request: Request, project_id: int):
    return JSONResponse(await commands_for_project(project_id))


async def store(request: Request, project_id: int):
    body = await request.json()
    label = (body.get("label") or "").strip()
    command = (body.get("command") or "").strip()
    if not label or not command:
        return JSONResponse({"error": "label and command are required"}, status_code=422)

    description = (body.get("description") or "").strip()
    category = (body.get("category") or "General").strip()
    shortcut = (body.get("shortcut") or "").strip()

    cmd = await Command.create(
        {
            "project_id": project_id,
            "label": label,
            "command": command,
            "description": description,
            "category": category,
            "shortcut": shortcut,
            "status": "stopped",
        }
    )
    return JSONResponse(_serialize(cmd), status_code=201)


async def update(request: Request, command_id: int):
    cmd = await Command.find(command_id)
    if not cmd:
        return JSONResponse({"error": "not found"}, status_code=404)

    body = await request.json()
    if "label" in body:
        cmd.label = (body["label"] or "").strip()
    if "command" in body:
        cmd.command = (body["command"] or "").strip()
    if "description" in body:
        cmd.description = (body["description"] or "").strip()
    if "category" in body:
        cmd.category = (body["category"] or "General").strip()
    if "shortcut" in body:
        cmd.shortcut = (body["shortcut"] or "").strip()

    await cmd.save()
    return JSONResponse(_serialize(cmd))


async def run(request: Request, command_id: int):
    cmd = await Command.find(command_id)
    if not cmd:
        return JSONResponse({"error": "not found"}, status_code=404)

    if cmd.status == "running" and command_id in _processes:
        return JSONResponse({"error": "already running"}, status_code=409)

    project = await Project.find(cmd.project_id)
    cwd = project.path if project and project.path else None

    try:
        proc = subprocess.Popen(
            cmd.command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=cwd,
            preexec_fn=os.setsid,  # own process group so we can kill the whole tree
        )
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)

    start_ts = time.monotonic()
    _processes[command_id] = proc
    _output[command_id] = deque(maxlen=_OUTPUT_LIMIT)
    threading.Thread(target=_stream_output, args=(command_id, proc, start_ts), daemon=True).start()

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


async def runs(request: Request, command_id: int):
    run_list = list(_runs.get(command_id, []))
    return JSONResponse(run_list)


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
    _runs.pop(command_id, None)
    await Command.where("id", command_id).delete()
    # 204 must carry no body — a JSON body here triggers a server-side
    # "Response content longer than Content-Length" RuntimeError on every delete.
    return Response(status_code=204)


def _pty_set_size(master_fd: int, rows: int, cols: int) -> None:
    size = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, size)


async def command_ws(websocket: WebSocket, project: str, command_id: int):
    cmd = await Command.find(command_id)
    if not cmd:
        await websocket.close(code=4004)
        return

    project_record = await Project.find(cmd.project_id)
    cwd = project_record.path if project_record and project_record.path else None

    await websocket.accept()

    master_fd, slave_fd = pty.openpty()
    _pty_set_size(master_fd, 24, 80)

    proc = subprocess.Popen(
        cmd.command,
        shell=True,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
        cwd=cwd,
        env=os.environ.copy(),
        preexec_fn=os.setsid,
    )
    os.close(slave_fd)
    _processes[command_id] = proc

    cmd.status = "running"
    cmd.pid = proc.pid
    await cmd.save()

    loop = asyncio.get_event_loop()
    stopped = asyncio.Event()

    async def pty_to_ws():
        queue: asyncio.Queue = asyncio.Queue()

        def on_readable():
            try:
                data = os.read(master_fd, 4096)
                if data:
                    queue.put_nowait(data)
            except OSError:
                pass

        loop.add_reader(master_fd, on_readable)
        try:
            while not stopped.is_set():
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=0.1)
                    await websocket.send_bytes(len(item).to_bytes(4, "big") + item)
                except asyncio.TimeoutError:
                    continue
                except Exception:
                    break
        finally:
            try:
                loop.remove_reader(master_fd)
            except Exception:
                pass

    async def ws_to_pty():
        while not stopped.is_set():
            try:
                msg = await websocket.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                if msg.get("bytes"):
                    data = msg["bytes"]
                    if len(data) >= 4:
                        length = int.from_bytes(data[:4], "big")
                        os.write(master_fd, data[4 : 4 + length])
                elif msg.get("text"):
                    try:
                        data = json.loads(msg["text"])
                        if data.get("type") == "resize":
                            _pty_set_size(master_fd, int(data["rows"]), int(data["cols"]))
                    except (json.JSONDecodeError, KeyError, ValueError):
                        pass
            except (WebSocketDisconnect, Exception):
                break
        stopped.set()

    async def watch_process():
        while proc.poll() is None and not stopped.is_set():
            await asyncio.sleep(0.1)
        stopped.set()

    tasks = [
        asyncio.create_task(pty_to_ws()),
        asyncio.create_task(ws_to_pty()),
        asyncio.create_task(watch_process()),
    ]

    try:
        await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        for t in tasks:
            t.cancel()
        _processes.pop(command_id, None)
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        try:
            os.close(master_fd)
        except OSError:
            pass
        try:
            fresh = await Command.find(command_id)
            if fresh:
                fresh.status = "stopped"
                fresh.pid = None
                await fresh.save()
        except Exception:
            pass
