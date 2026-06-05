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

from app.models.Agent import Agent
from app.models.Project import Project
from app.models.TerminalOutput import TerminalOutput
from app.models.TerminalSession import TerminalSession

_ANSI_ESCAPE = re.compile(rb'\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[^[]')


def _permission_flags(allow_json: str | None, deny_json: str | None) -> str:
    """Build --allowedTools / --disallowedTools flags from JSON column values."""
    flags = []
    if allow_json:
        try:
            allow = json.loads(allow_json)
            if allow:
                flags.append(f'--allowedTools {shlex.quote(",".join(allow))}')
        except (json.JSONDecodeError, TypeError):
            pass
    if deny_json:
        try:
            deny = json.loads(deny_json)
            if deny:
                flags.append(f'--disallowedTools {shlex.quote(",".join(deny))}')
        except (json.JSONDecodeError, TypeError):
            pass
    return (' ' + ' '.join(flags)) if flags else ''


def _extra_flags(flags_json: str | None) -> str:
    """Build extra claude CLI flags from agent.flags JSON.

    Supported keys:
      dangerously_skip_permissions: bool  → --dangerously-skip-permissions
      verbose: bool                       → --verbose
      max_turns: int | null               → --max-turns N
    """
    if not flags_json:
        return ''
    try:
        flags = json.loads(flags_json)
    except (json.JSONDecodeError, TypeError):
        return ''
    parts = []
    if flags.get('dangerously_skip_permissions'):
        parts.append('--dangerously-skip-permissions')
    if flags.get('verbose'):
        parts.append('--verbose')
    max_turns = flags.get('max_turns')
    if max_turns:
        try:
            parts.append(f'--max-turns {int(max_turns)}')
        except (TypeError, ValueError):
            pass
    return (' ' + ' '.join(parts)) if parts else ''


_PLAN_MODE_PREFIX = (
    "You are in PLAN-ONLY mode. Analyze and plan — do NOT write or edit any files, "
    "run commands, or execute any tool that modifies the filesystem or codebase. "
    "Only Read and Glob tools are permitted.\n\n"
)


def _apply_plan_mode(system_prompt: str, flags_json: str | None) -> str:
    """Prepend the plan-mode instruction to the system prompt when plan_mode flag is set."""
    try:
        flags = json.loads(flags_json) if flags_json else {}
    except (json.JSONDecodeError, TypeError):
        flags = {}
    if flags.get('plan_mode'):
        return _PLAN_MODE_PREFIX + system_prompt
    return system_prompt


# Registry: project_path -> active WebSocket (frontend connection)
connections: dict[str, WebSocket] = {}

# Registry: project_path -> callable that writes bytes to the PTY
pty_writers: dict[str, callable] = {}

# Registry: conn_key -> Popen — used by shutdown handler to kill all PTY processes
_pty_procs: dict[str, subprocess.Popen] = {}

# Registry: conn_key -> master_fd for PTY output reading
_pty_fds: dict[str, int] = {}

# Registry: conn_key -> Event set when Claude has finished starting up and is ready for input
claude_ready: dict[str, asyncio.Event] = {}


async def _deliver_pending_relay_messages(agent_id: int, cwd: str) -> None:
    """Inject any queued agent-to-agent relay messages into the running PTY."""
    from app.models.AgentRelayMessage import AgentRelayMessage
    from app.models.Agent import Agent

    pending = await AgentRelayMessage.where("to_agent_id", agent_id) \
        .where("status", "pending").order_by("id", "asc").get()
    if not pending:
        return

    await asyncio.sleep(2.0)  # Let Claude finish starting up

    conn_key = f"{cwd}:agent:{agent_id}"
    write_fn = pty_writers.get(conn_key)

    for msg in pending:
        from_agent = await Agent.find(msg.from_agent_id)
        sender_name = from_agent.name if from_agent else f"Agent #{msg.from_agent_id}"
        if write_fn:
            text = f"[Message from Agent '{sender_name}']: {msg.content}\r"
            write_fn(text.encode())
        await AgentRelayMessage.where("id", msg.id).update({"status": "delivered"})


def _set_size(master_fd: int, rows: int, cols: int) -> None:
    size = struct.pack('HHHH', rows, cols, 0, 0)
    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, size)


def _strip_ansi(data: bytes) -> str:
    return _ANSI_ESCAPE.sub(b'', data).decode('utf-8', errors='replace')


async def terminal_ws(websocket: WebSocket, project: str, agent_id: int = Query()):
    await websocket.accept()

    project_record = await Project.where("slug", project).first()
    if not project_record:
        await websocket.close(code=1008, reason="Project not found")
        return

    cwd = os.path.expanduser(project_record.path)
    os.makedirs(cwd, exist_ok=True)

    conn_key = f"{cwd}:agent:{agent_id}"

    # If a PTY is already running for this agent, attach the WebSocket
    # to the existing PTY instead of spawning a second claude instance.
    existing_proc = _pty_procs.get(conn_key)
    if existing_proc and existing_proc.poll() is None:
        connections[conn_key] = websocket
        write_fn = pty_writers.get(conn_key)
        master_fd = _pty_fds.get(conn_key)

        attach_stopped = asyncio.Event()

        async def attach_pty_to_ws():
            """Forward PTY output to the newly attached WebSocket."""
            if master_fd is None:
                return
            queue: asyncio.Queue = asyncio.Queue()

            def on_readable():
                try:
                    data = os.read(master_fd, 4096)
                    if data:
                        queue.put_nowait(data)
                except OSError:
                    pass

            loop = asyncio.get_event_loop()
            loop.add_reader(master_fd, on_readable)
            try:
                while not attach_stopped.is_set():
                    try:
                        item = await asyncio.wait_for(queue.get(), timeout=0.1)
                        await websocket.send_bytes(item)
                    except asyncio.TimeoutError:
                        continue
            except Exception:
                pass
            finally:
                try:
                    loop.remove_reader(master_fd)
                except Exception:
                    pass

        async def attach_ws_to_pty():
            """Forward WebSocket input to the existing PTY."""
            while not attach_stopped.is_set():
                try:
                    msg = await websocket.receive()
                    if msg.get('type') == 'websocket.disconnect':
                        break
                    if msg.get('bytes') and write_fn:
                        write_fn(msg['bytes'])
                    elif msg.get('text'):
                        try:
                            payload = json.loads(msg['text'])
                            if payload.get('type') == 'resize' and master_fd is not None:
                                _set_size(master_fd, int(payload['rows']), int(payload['cols']))
                        except (json.JSONDecodeError, KeyError, ValueError):
                            pass
                except (WebSocketDisconnect, Exception):
                    break
            attach_stopped.set()

        tasks = [
            asyncio.create_task(attach_pty_to_ws()),
            asyncio.create_task(attach_ws_to_pty()),
        ]
        try:
            await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            for t in tasks:
                t.cancel()
            connections.pop(conn_key, None)
        return

    project_name = os.path.basename(cwd)

    session = await TerminalSession.create({
        'project_name': project_name,
        'project_path': cwd,
    })

    agent_record = await Agent.find(agent_id)
    if not agent_record:
        await websocket.close(code=1008, reason="Agent not found")
        return

    connections[conn_key] = websocket

    shell = os.environ.get('SHELL', '/bin/bash')
    master_fd, slave_fd = pty.openpty()
    _set_size(master_fd, 24, 80)

    pty_writers[conn_key] = lambda data: os.write(master_fd, data if isinstance(data, bytes) else data.encode())
    _pty_fds[conn_key] = master_fd

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
    _pty_procs[conn_key] = proc

    loop = asyncio.get_event_loop()
    stopped = asyncio.Event()

    async def auto_continue():
        """Wait for the shell to be ready, cd into the project dir, then launch claude."""
        await asyncio.sleep(0.5)
        if stopped.is_set():
            return
        os.write(master_fd, f'cd {shlex.quote(cwd)}\n'.encode())
        await asyncio.sleep(0.1)

        system_prompt = agent_record.system_prompt or ''
        model = agent_record.model or ''
        has_session = agent_record.has_session or False
        task_id = agent_record.task_id or None
        worktree_name = f'agent-{task_id}' if task_id else f'agent-{agent_record.id}'

        # Apply plan-mode prefix and build extra CLI flags from agent.flags
        agent_flags_json = getattr(agent_record, 'flags', None)
        full_prompt = _apply_plan_mode(system_prompt, agent_flags_json).strip()
        model_flag = f' --model {shlex.quote(model)}' if model else ''
        extra_flags = _extra_flags(agent_flags_json)

        prompt_file = f'/tmp/keera-agent-{agent_record.id}.txt'
        with open(prompt_file, 'w') as _pf:
            _pf.write(full_prompt)
        sp_ref = f" --system-prompt \"$(cat {shlex.quote(prompt_file)})\""

        wt_flag = f' --worktree {shlex.quote(worktree_name)}'
        if has_session:
            os.write(master_fd, f'claude{wt_flag} --continue{model_flag}{extra_flags}\n'.encode())
        else:
            os.write(master_fd, f'claude{wt_flag}{sp_ref}{model_flag}{extra_flags}\n'.encode())
            await Agent.where("id", agent_record.id).update({"has_session": True})

        # Signal that Claude is ready for input
        ready_event = claude_ready.setdefault(conn_key, asyncio.Event())
        await asyncio.sleep(1.5)  # let Claude finish its startup banner
        ready_event.set()

        asyncio.create_task(_deliver_pending_relay_messages(agent_record.id, cwd))

    async def pty_to_ws():
        """Read PTY output and forward to WebSocket.
        Keeps running until the shell process exits — transient OSErrors
        (e.g. when a child process forks/execs) are ignored."""
        queue: asyncio.Queue = asyncio.Queue()
        new_session_started = False
        output_buf = ''

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
                    await websocket.send_bytes(item)
                    text = _strip_ansi(item).strip()
                    if not new_session_started and not agent_record:
                        output_buf = (output_buf + ' ' + text)[-2000:]
                        # Detect failed --continue on project terminal and fall back to fresh start
                        if 'No conversation' in output_buf and 'continue' in output_buf:
                            new_session_started = True
                            await asyncio.sleep(0.2)
                            system_prompt = getattr(project_record, 'system_prompt', None) if project_record else None
                            sp_flag = f' --system-prompt {shlex.quote(system_prompt)}' if system_prompt else ''
                            os.write(master_fd, f'claude{sp_flag}\n'.encode())
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
        while proc.poll() is None and not stopped.is_set():
            await asyncio.sleep(0.1)
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
        connections.pop(conn_key, None)
        pty_writers.pop(conn_key, None)
        _pty_procs.pop(conn_key, None)
        _pty_fds.pop(conn_key, None)
        claude_ready.pop(conn_key, None)
        try:
            proc.kill()
        except Exception:
            pass
        try:
            os.close(master_fd)
        except OSError:
            pass
