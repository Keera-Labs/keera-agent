import asyncio
import fcntl
import os
import pty
import re
import shlex
import struct
import subprocess
import termios

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Agent import Agent
from app.models.Project import Project
from app.controllers.terminal_controller import pty_writers, connections, _pty_procs, _pty_fds, claude_ready

_ANSI_ESCAPE = re.compile(rb'\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[^[]')



async def _inject_when_ready(conn_key: str, write_fn, message: str, timeout: float = 30.0) -> None:
    """Wait for Claude to signal ready, then inject the message. Falls back after timeout."""
    event = claude_ready.get(conn_key)
    if event:
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            pass
    write_fn(f"{message}\r".encode())


async def trigger(request: Request, agent_id: int):
    """
    Trigger an agent with an initial message.
    If the agent's PTY is already running (WebSocket terminal open), waits for Claude
    to be ready then injects the message. Otherwise spawns a headless PTY, starts
    Claude interactively, and injects the message once it's ready.
    """
    body = await request.json()
    message = (body.get("message") or "").strip()
    if not message:
        return JSONResponse({"error": "message is required"}, status_code=400)

    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)

    project = await Project.find(agent.project_id)
    if not project:
        return JSONResponse({"error": "Project not found"}, status_code=404)

    cwd = os.path.expanduser(project.path)
    conn_key = f"{cwd}:agent:{agent_id}"

    # If an interactive Claude session is already running, wait for it to be ready then inject
    write_fn = pty_writers.get(conn_key)
    if write_fn:
        asyncio.create_task(_inject_when_ready(conn_key, write_fn, message))
        return JSONResponse({"status": "injected", "message": "Message queued for running agent"})

    # No PTY running — spawn a headless shell and run claude -p
    asyncio.create_task(_spawn_headless_agent(agent, project, cwd, conn_key, message))
    return JSONResponse({"status": "starting", "message": "Agent is starting up..."})


async def _spawn_headless_agent(agent, project, cwd: str, conn_key: str, initial_message: str) -> None:
    """Spawn a PTY for the agent without a WebSocket — triggered from the backend."""
    from app.models.Agent import Agent as _Agent
    from app.utils.hook_setup import BASE_URL as base_url
    from app.models.TerminalSession import TerminalSession
    from app.models.TerminalOutput import TerminalOutput

    shell = os.environ.get('SHELL', '/bin/bash')
    master_fd, slave_fd = pty.openpty()

    # Set terminal size
    size = struct.pack('HHHH', 24, 80, 0, 0)
    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, size)

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
    _pty_fds[conn_key] = master_fd
    pty_writers[conn_key] = lambda data: os.write(master_fd, data if isinstance(data, bytes) else data.encode())

    session = await TerminalSession.create({
        'project_name': os.path.basename(cwd),
        'project_path': project.path,
    })

    loop = asyncio.get_event_loop()
    stopped = asyncio.Event()

    # Shared state for the "no conversation" fallback
    _fallback: dict = {'sp_flag': '', 'model_flag': '', 'perm_flag': '', 'done': False}

    async def read_output():
        queue: asyncio.Queue = asyncio.Queue()
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
                    # Forward to WebSocket if frontend has connected
                    ws = connections.get(conn_key)
                    if ws:
                        try:
                            await ws.send_bytes(item)
                        except Exception:
                            pass
                    text = _ANSI_ESCAPE.sub(b'', item).decode('utf-8', errors='replace').strip()
                    # Detect "--continue" finding no session and fall back to a fresh start
                    if not _fallback['done'] and _fallback['sp_flag']:
                        output_buf = (output_buf + ' ' + text)[-2000:]
                        if 'No conversation' in output_buf and 'continue' in output_buf:
                            _fallback['done'] = True
                            await asyncio.sleep(0.2)
                            sp = _fallback['sp_flag']
                            mf = _fallback['model_flag']
                            pf = _fallback['perm_flag']
                            os.write(master_fd, f'claude{sp}{mf}{pf}\n'.encode())
                    if text and '(thinking)' not in text:
                        await TerminalOutput.create({'session_id': session.id, 'data': text})
                except asyncio.TimeoutError:
                    continue
        finally:
            loop.remove_reader(master_fd)

    async def watch_proc():
        await loop.run_in_executor(None, proc.wait)
        stopped.set()

    async def start_agent():
        await asyncio.sleep(0.5)
        if stopped.is_set():
            return

        os.write(master_fd, f'cd {shlex.quote(cwd)}\n'.encode())
        await asyncio.sleep(0.1)

        system_prompt = getattr(agent, 'system_prompt', None) or ''
        model = getattr(agent, 'model', None)
        task_id = getattr(agent, 'task_id', None)
        worktree_name = f'agent-{task_id}' if task_id else f'agent-{agent.id}'

        from app.controllers.terminal_controller import _permission_flags
        perm_flag = _permission_flags(
            getattr(agent, 'permissions_allow', None),
            getattr(agent, 'permissions_deny', None),
        )

        siblings = await _Agent.where("project_id", agent.project_id)\
            .where("id", "!=", agent.id).get()
        if siblings:
            agent_roster = "\n".join(f"  - {a.name} (ID: {a.id})" for a in siblings)
            roster_section = f"\nAgents you can message:\n{agent_roster}\n"
        else:
            roster_section = "\nNo other agents are currently registered in this project.\n"

        relay_instructions = (
            f"\n\n---\n"
            f"AGENT COMMUNICATION PROTOCOL\n"
            f"Your agent ID is: {agent.id}\n"
            f"Project ID: {agent.project_id}\n"
            f"Project directory: {cwd}\n"
            f"{roster_section}"
            f"To send a message to another agent, use the MCP tool relay_to_agent or run:\n"
            f"  curl -s -X POST {base_url}/api/agent-relay \\\n"
            f"    -H 'Content-Type: application/json' \\\n"
            f"    -d '{{\"from_agent_id\": {agent.id}, \"to_agent_id\": TARGET_ID, \"content\": \"your message\"}}'\n"
            f"Messages you receive appear as: [Message from Agent '<name>']: <content>\n"
            f"To create and start a NEW agent use the MCP tool spawn_agent."
        )
        full_prompt = (system_prompt + relay_instructions).strip()

        # Write system prompt to temp file — newlines break PTY input if passed inline
        prompt_file = f'/tmp/keera-agent-{agent.id}.txt'
        with open(prompt_file, 'w') as _pf:
            _pf.write(full_prompt)

        # Start Claude interactively (same as WebSocket terminal) so relay messages work
        wt_flag = f' --worktree {shlex.quote(worktree_name)}'
        model_flag = f' --model {shlex.quote(model)}' if model else ''
        sp_ref = f" --system-prompt \"$(cat {shlex.quote(prompt_file)})\""
        has_session = bool(getattr(agent, 'has_session', False))
        if has_session:
            os.write(master_fd, f'claude{wt_flag} --continue{model_flag}\n'.encode())
        else:
            os.write(master_fd, f'claude{wt_flag}{sp_ref}{model_flag}\n'.encode())
            await _Agent.where("id", agent.id).update({"has_session": True})

        # Signal ready after Claude's startup banner, then inject the initial message
        ready_event = claude_ready.setdefault(conn_key, asyncio.Event())
        await asyncio.sleep(1.5)
        ready_event.set()
        write_fn = pty_writers.get(conn_key)
        if write_fn:
            write_fn(f"{initial_message}\r".encode())

        # Notify the frontend so it can show the agent as active
        ws = connections.get(cwd)
        if ws:
            import json as _json
            try:
                await ws.send_text(_json.dumps({
                    "type": "agent_triggered",
                    "agent_id": agent.id,
                    "message": initial_message,
                }))
            except Exception:
                pass

    tasks = [
        asyncio.create_task(read_output()),
        asyncio.create_task(watch_proc()),
        asyncio.create_task(start_agent()),
    ]

    try:
        await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        for t in tasks:
            t.cancel()
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
