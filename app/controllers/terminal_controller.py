import asyncio
import fcntl
import json
import os
import pty
import re
import shlex
import struct
import subprocess
import termios

from fastapi import Query, WebSocket, WebSocketDisconnect

from app.models.Project import Project
from app.models.TerminalOutput import TerminalOutput
from app.models.TerminalSession import TerminalSession

_ANSI_ESCAPE = re.compile(rb'\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[^[]')

# Registry: project_path -> active WebSocket (frontend connection)
connections: dict[str, WebSocket] = {}

# Registry: project_path -> callable that writes bytes to the PTY
pty_writers: dict[str, callable] = {}


def _set_size(master_fd: int, rows: int, cols: int) -> None:
    size = struct.pack('HHHH', rows, cols, 0, 0)
    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, size)


def _strip_ansi(data: bytes) -> str:
    return _ANSI_ESCAPE.sub(b'', data).decode('utf-8', errors='replace')


async def terminal_ws(websocket: WebSocket, project: str, path: str = Query(default='')):
    await websocket.accept()

    cwd = os.path.expanduser(path) if path else os.getcwd()
    os.makedirs(cwd, exist_ok=True)

    project_name = os.path.basename(cwd)

    session = await TerminalSession.create({
        'project_name': project_name,
        'project_path': path or cwd,
    })

    # Link session to project, mark as running, and register connection
    project_record = await Project.where('path', path or cwd).first()
    if project_record:
        await Project.where('id', project_record.id).update({
            'last_session_id': session.id,
            'claude_status': 'running',
        })
    connections[path or cwd] = websocket

    shell = os.environ.get('SHELL', '/bin/bash')
    master_fd, slave_fd = pty.openpty()
    _set_size(master_fd, 24, 80)

    pty_writers[path or cwd] = lambda data: os.write(master_fd, data if isinstance(data, bytes) else data.encode())

    proc = subprocess.Popen(
        [shell],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
        cwd=cwd,
        env=os.environ.copy(),
    )
    os.close(slave_fd)

    loop = asyncio.get_event_loop()
    stopped = asyncio.Event()

    async def auto_continue():
        """Wait for the shell to be ready, cd into the project dir, then launch claude.
        Use --continue only if prior sessions exist for this path."""
        await asyncio.sleep(0.5)
        if stopped.is_set():
            return
        os.write(master_fd, f'cd {shlex.quote(cwd)}\n'.encode())
        await asyncio.sleep(0.1)
        prior = await TerminalSession.where('project_path', path or cwd).get()
        # prior includes the session we just created, so >1 means genuinely previous sessions
        if len(prior) > 1:
            os.write(master_fd, b'claude --continue\n')
        else:
            os.write(master_fd, b'claude\n')

    async def pty_to_ws():
        """Read PTY output and forward to WebSocket.
        Keeps running until the shell process exits — transient OSErrors
        (e.g. when a child process forks/execs) are ignored."""
        queue: asyncio.Queue = asyncio.Queue()
        new_session_started = False
        # Rolling buffer to catch messages that span multiple reads
        output_buf = ''

        def on_readable():
            try:
                data = os.read(master_fd, 4096)
                if data:
                    queue.put_nowait(data)
            except OSError:
                # Transient — a child process may have briefly held the slave.
                # Re-register the reader; the process exit task will stop us.
                pass

        loop.add_reader(master_fd, on_readable)

        try:
            while not stopped.is_set():
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=0.1)
                    await websocket.send_bytes(item)
                    text = _strip_ansi(item).strip()
                    if not new_session_started:
                        output_buf = (output_buf + ' ' + text)[-2000:]
                        if 'No conversation' in output_buf and 'continue' in output_buf:
                            new_session_started = True
                            await asyncio.sleep(0.2)
                            os.write(master_fd, b'claude\n')
                    if text and '(thinking)' not in text:
                        await TerminalOutput.create({
                            'session_id': session.id,
                            'data': text,
                        })
                except asyncio.TimeoutError:
                    continue
        finally:
            try:
                loop.remove_reader(master_fd)
            except Exception:
                pass

    async def ws_to_pty():
        """Forward WebSocket input to the PTY."""
        while not stopped.is_set():
            try:
                msg = await websocket.receive()
                if msg.get('type') == 'websocket.disconnect':
                    break
                if msg.get('bytes'):
                    os.write(master_fd, msg['bytes'])
                elif msg.get('text'):
                    try:
                        data = json.loads(msg['text'])
                        if data.get('type') == 'resize':
                            _set_size(master_fd, int(data['rows']), int(data['cols']))
                    except (json.JSONDecodeError, KeyError, ValueError):
                        pass
            except (WebSocketDisconnect, Exception):
                break
        stopped.set()

    async def watch_process():
        """Signal stopped when the shell process exits."""
        await loop.run_in_executor(None, proc.wait)
        stopped.set()

    tasks = [
        asyncio.create_task(pty_to_ws()),
        asyncio.create_task(ws_to_pty()),
        asyncio.create_task(watch_process()),
        asyncio.create_task(auto_continue()),
    ]

    try:
        await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        for t in tasks:
            t.cancel()
        connections.pop(path or cwd, None)
        pty_writers.pop(path or cwd, None)
        try:
            proc.kill()
        except Exception:
            pass
        try:
            os.close(master_fd)
        except OSError:
            pass
