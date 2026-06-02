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
from app.controllers.terminal_controller import pty_writers, connections, _pty_procs

_ANSI_ESCAPE = re.compile(rb'\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[^[]')


async def trigger(request: Request, agent_id: int):
    """
    Trigger an agent to start with an initial message.
    If the agent's PTY is already running, inject the message directly.
    Otherwise, spawn a headless PTY, start Claude, and send the message.
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

    # If already running, inject directly
    write_fn = pty_writers.get(conn_key)
    if write_fn:
        write_fn(f"{message}\n".encode())
        return JSONResponse({"status": "injected", "message": "Message delivered to running agent"})

    # Spawn headless PTY and start the agent
    asyncio.create_task(_spawn_headless_agent(agent, project, cwd, conn_key, message))
    return JSONResponse({"status": "starting", "message": "Agent is starting up..."})


async def _spawn_headless_agent(agent, project, cwd: str, conn_key: str, initial_message: str) -> None:
    """Spawn a PTY for the agent without a WebSocket — triggered from the backend."""
    from fastapi_startkit.environment import env as _env
    from app.models.Agent import Agent as _Agent
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
    pty_writers[conn_key] = lambda data: os.write(master_fd, data if isinstance(data, bytes) else data.encode())

    session = await TerminalSession.create({
        'project_name': os.path.basename(cwd),
        'project_path': project.path,
    })

    loop = asyncio.get_event_loop()
    stopped = asyncio.Event()

    async def read_output():
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
                    text = _ANSI_ESCAPE.sub(b'', item).decode('utf-8', errors='replace').strip()
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

        # Use a per-agent subdirectory so each agent has its own Claude conversation
        agent_cwd = os.path.join(cwd, '.keera-agents', f'agent_{agent.id}')
        os.makedirs(agent_cwd, exist_ok=True)
        os.write(master_fd, f'cd {shlex.quote(agent_cwd)}\n'.encode())
        await asyncio.sleep(0.1)

        system_prompt = getattr(agent, 'system_prompt', None) or ''
        model = getattr(agent, 'model', None)
        has_session = bool(getattr(agent, 'has_session', False))
        base_url = _env("KEERA_AGENT_URL", "http://localhost:4545")

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
            f"To send a message to another agent, run:\n"
            f"  curl -s -X POST {base_url}/api/agent-relay \\\n"
            f"    -H 'Content-Type: application/json' \\\n"
            f"    -d '{{\"from_agent_id\": {agent.id}, \"to_agent_id\": TARGET_ID, \"content\": \"your message\"}}'\n"
            f"Replace TARGET_ID with the numeric ID from the list above.\n"
            f"Messages you receive appear as: [Message from Agent '<name>']: <content>\n"
            f"Always reply to messages you receive.\n"
            f"\n"
            f"To create and start a NEW agent (it will appear in the sidebar automatically), run:\n"
            f"  curl -s -X POST {base_url}/api/projects/{agent.project_id}/agents/spawn \\\n"
            f"    -H 'Content-Type: application/json' \\\n"
            f"    -d '{{\"name\": \"Agent Name\", \"agent_type\": \"software_engineer\", \"message\": \"Initial task for the agent\"}}'\n"
            f"Valid agent_type values: pm, software_engineer, qa, custom\n"
            f"The 'message' field is optional — omit it to create an idle agent.\n"
            f"The new agent's ID will be in the response JSON — use it to send relay messages."
        )
        full_prompt = (system_prompt + relay_instructions).strip()
        sp_flag = f' --system-prompt {shlex.quote(full_prompt)}'
        model_flag = f' --model {shlex.quote(model)}' if model else ''
        if has_session:
            # Resume existing conversation — system prompt is already embedded
            os.write(master_fd, f'claude --continue{model_flag}\n'.encode())
        else:
            # First run: start fresh with full system prompt
            os.write(master_fd, f'claude{sp_flag}{model_flag}\n'.encode())
            await _Agent.where("id", agent.id).update({"has_session": True})

        # Wait for Claude to finish starting up, then send the initial message
        await asyncio.sleep(4.0)
        if not stopped.is_set():
            write_fn = pty_writers.get(conn_key)
            if write_fn:
                write_fn(f"{initial_message}\n".encode())

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
        try:
            proc.kill()
        except Exception:
            pass
        try:
            os.close(master_fd)
        except OSError:
            pass
