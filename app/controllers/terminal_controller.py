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

from app.models.AgentMessage import AgentMessage
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


# Registry: project_path -> active WebSocket (frontend connection)
connections: dict[str, WebSocket] = {}

# Registry: project_path -> callable that writes bytes to the PTY
pty_writers: dict[str, callable] = {}

# Registry: conn_key -> Popen — used by shutdown handler to kill all PTY processes
_pty_procs: dict[str, subprocess.Popen] = {}


async def _deliver_pending_relay_messages(agent_id: int, cwd: str) -> None:
    """Inject any queued agent-to-agent relay messages into the running PTY."""
    from app.models.AgentRelayMessage import AgentRelayMessage
    from app.models.Agent import Agent

    pending = await AgentRelayMessage.where("to_agent_id", agent_id)\
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
            text = f"[Message from Agent '{sender_name}']: {msg.content}\n"
            write_fn(text.encode())
        await AgentRelayMessage.where("id", msg.id).update({"status": "delivered"})


async def _deliver_pending_messages(project, cwd: str) -> None:
    """Inject any undelivered messages into the PTY and notify the frontend."""
    import json as _json

    pending = await AgentMessage.where("receiver_project_id", project.id)\
        .where("status", "pending").order_by("id", "asc").get()
    if not pending:
        return

    senders = await Project.all()
    sender_map = {p.id: p for p in senders}

    await asyncio.sleep(1.5)  # Let Claude finish starting up

    write = pty_writers.get(cwd)
    ws = connections.get(cwd)

    for msg in pending:
        sender_name = sender_map[msg.sender_project_id].name \
            if msg.sender_project_id in sender_map else str(msg.sender_project_id)
        if write:
            write(f"[Message from {sender_name}]: {msg.content}\r")
        await AgentMessage.where("id", msg.id).update({"status": "delivered"})
        if ws:
            try:
                await ws.send_text(_json.dumps({
                    "type": "agent_message",
                    "message_id": msg.id,
                    "sender_name": sender_name,
                    "content": msg.content,
                }))
            except Exception:
                pass


def _set_size(master_fd: int, rows: int, cols: int) -> None:
    size = struct.pack('HHHH', rows, cols, 0, 0)
    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, size)


def _strip_ansi(data: bytes) -> str:
    return _ANSI_ESCAPE.sub(b'', data).decode('utf-8', errors='replace')


async def terminal_ws(websocket: WebSocket, project: str, path: str = Query(default=''), agent_id: int = Query(default=None)):
    await websocket.accept()

    cwd = os.path.expanduser(path) if path else os.getcwd()
    os.makedirs(cwd, exist_ok=True)

    project_name = os.path.basename(cwd)

    session = await TerminalSession.create({
        'project_name': project_name,
        'project_path': path or cwd,
    })

    # Look up the associated project and optional agent
    project_record = await Project.where('path', path or cwd).first()
    agent_record = None
    if agent_id:
        from app.models.Agent import Agent
        agent_record = await Agent.find(agent_id)

    # Agent terminals use a namespaced key so they don't displace the project terminal
    conn_key = f"{cwd}:agent:{agent_id}" if agent_id else cwd

    # Only track status on the project terminal (not per-agent terminals)
    if not agent_id and project_record:
        await Project.where('id', project_record.id).update({
            'last_session_id': session.id,
            'claude_status': 'running',
        })

    connections[conn_key] = websocket

    shell = os.environ.get('SHELL', '/bin/bash')
    master_fd, slave_fd = pty.openpty()
    _set_size(master_fd, 24, 80)

    pty_writers[conn_key] = lambda data: os.write(master_fd, data if isinstance(data, bytes) else data.encode())

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

    # Shared agent flags — computed in auto_continue, used as fallback in pty_to_ws
    _agent_flags: dict = {'sp_flag': '', 'model_flag': '', 'perm_flag': '', 'ready': False}

    async def auto_continue():
        """Wait for the shell to be ready, cd into the project dir, then launch claude."""
        from app.models.Agent import Agent as _Agent

        await asyncio.sleep(0.5)
        if stopped.is_set():
            return
        os.write(master_fd, f'cd {shlex.quote(cwd)}\n'.encode())
        await asyncio.sleep(0.1)

        if agent_record:
            # Each agent gets its own subdirectory so Claude stores conversations separately
            agent_cwd = os.path.join(cwd, '.keera-agents', f'agent_{agent_record.id}')
            os.makedirs(agent_cwd, exist_ok=True)
            os.write(master_fd, f'cd {shlex.quote(agent_cwd)}\n'.encode())
            await asyncio.sleep(0.1)

            system_prompt = getattr(agent_record, 'system_prompt', None) or ''
            model = getattr(agent_record, 'model', None)
            has_session = bool(getattr(agent_record, 'has_session', False))
            perm_flag = _permission_flags(
                getattr(agent_record, 'permissions_allow', None),
                getattr(agent_record, 'permissions_deny', None),
            )

            from fastapi_startkit.environment import env as _env
            base_url = _env("KEERA_AGENT_URL", "http://localhost:4545")

            siblings = await _Agent.where("project_id", agent_record.project_id)\
                .where("id", "!=", agent_record.id).get()
            if siblings:
                agent_roster = "\n".join(f"  - {a.name} (ID: {a.id})" for a in siblings)
                roster_section = f"\nAgents you can message:\n{agent_roster}\n"
            else:
                roster_section = "\nNo other agents are currently registered in this project.\n"

            relay_instructions = (
                f"\n\n---\n"
                f"AGENT COMMUNICATION PROTOCOL\n"
                f"Your agent ID is: {agent_record.id}\n"
                f"Project ID: {agent_record.project_id}\n"
                f"Project directory: {cwd}\n"
                f"{roster_section}"
                f"To send a message to another agent, run:\n"
                f"  curl -s -X POST {base_url}/api/agent-relay \\\n"
                f"    -H 'Content-Type: application/json' \\\n"
                f"    -d '{{\"from_agent_id\": {agent_record.id}, \"to_agent_id\": TARGET_ID, \"content\": \"your message\"}}'\n"
                f"Replace TARGET_ID with the numeric ID from the list above.\n"
                f"Messages you receive appear as: [Message from Agent '<name>']: <content>\n"
                f"Always reply to messages you receive.\n"
                f"\n"
                f"To create and start a NEW agent (it will appear in the sidebar automatically), run:\n"
                f"  curl -s -X POST {base_url}/api/projects/{agent_record.project_id}/agents/spawn \\\n"
                f"    -H 'Content-Type: application/json' \\\n"
                f"    -d '{{\"name\": \"Agent Name\", \"agent_type\": \"software_engineer\", \"message\": \"Initial task for the agent\"}}'\n"
                f"Valid agent_type values: pm, software_engineer, qa, custom\n"
                f"The 'message' field is optional — omit it to create an idle agent.\n"
                f"The new agent's ID will be in the response JSON — use it to send relay messages."
            )
            full_prompt = (system_prompt + relay_instructions).strip()
            sp_flag = f' --system-prompt {shlex.quote(full_prompt)}'
            model_flag = f' --model {shlex.quote(model)}' if model else ''

            # Store flags for pty_to_ws fallback (used if --continue finds no conversation)
            _agent_flags['sp_flag'] = sp_flag
            _agent_flags['model_flag'] = model_flag
            _agent_flags['perm_flag'] = perm_flag
            _agent_flags['ready'] = True

            if has_session:
                # Resume existing conversation, re-inject system prompt so role is never lost
                os.write(master_fd, f'claude --continue{sp_flag}{model_flag}{perm_flag}\n'.encode())
            else:
                # First run: start fresh with full system prompt
                os.write(master_fd, f'claude{sp_flag}{model_flag}{perm_flag}\n'.encode())
                await _Agent.where("id", agent_record.id).update({"has_session": True})

            asyncio.create_task(_deliver_pending_relay_messages(agent_record.id, cwd))
        else:
            # Project terminal: resume previous session if one exists
            system_prompt = getattr(project_record, 'system_prompt', None) if project_record else None
            sp_flag = f' --system-prompt {shlex.quote(system_prompt)}' if system_prompt else ''
            perm_flag = _permission_flags(
                getattr(project_record, 'permissions_allow', None) if project_record else None,
                getattr(project_record, 'permissions_deny', None) if project_record else None,
            )

            prior = await TerminalSession.where('project_path', path or cwd).get()
            if len(prior) > 1:
                os.write(master_fd, f'claude --continue{sp_flag}{perm_flag}\n'.encode())
            else:
                os.write(master_fd, f'claude{sp_flag}{perm_flag}\n'.encode())

            if project_record:
                await _deliver_pending_messages(project_record, cwd)

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
                    if not new_session_started:
                        output_buf = (output_buf + ' ' + text)[-2000:]
                        if 'No conversation' in output_buf and 'continue' in output_buf:
                            new_session_started = True
                            await asyncio.sleep(0.2)
                            if agent_record and _agent_flags['ready']:
                                # Agent --continue found no conversation: fresh start with system prompt
                                sp = _agent_flags['sp_flag']
                                mf = _agent_flags['model_flag']
                                pf = _agent_flags.get('perm_flag', '')
                                os.write(master_fd, f'claude{sp}{mf}{pf}\n'.encode())
                            else:
                                # Project terminal fallback
                                system_prompt = getattr(project_record, 'system_prompt', None) if project_record else None
                                sp_flag = f' --system-prompt {shlex.quote(system_prompt)}' if system_prompt else ''
                                perm_flag = _permission_flags(
                                    getattr(project_record, 'permissions_allow', None) if project_record else None,
                                    getattr(project_record, 'permissions_deny', None) if project_record else None,
                                )
                                os.write(master_fd, f'claude{sp_flag}{perm_flag}\n'.encode())
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
        connections.pop(conn_key, None)
        pty_writers.pop(conn_key, None)
        _pty_procs.pop(conn_key, None)
        try:
            proc.kill()
        except Exception:
            pass
        try:
            os.close(master_fd)
        except OSError:
            pass
