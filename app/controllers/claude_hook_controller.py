import asyncio
import json
import os

from fastapi import Request
from fastapi.responses import JSONResponse

from app.controllers.terminal_controller import connections, pty_writers
from app.models.Agent import Agent
from app.models.AgentRelayMessage import AgentRelayMessage
from app.models.Project import Project
from app.models.Task import Task


async def _find_project_by_cwd(cwd: str):
    """Find a project whose path matches cwd, handling ~ vs absolute path differences."""
    project = await Project.where('path', cwd).first()
    if project:
        return project
    all_projects = await Project.all()
    return next((p for p in all_projects if os.path.expanduser(p.path) == cwd), None)


async def claude_started(request: Request):
    """
    Receives the Claude Code UserPromptSubmit hook POST.
    Marks the first pending task for the project as started.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    cwd = body.get('cwd', '')
    if not cwd:
        return JSONResponse({}, status_code=200)

    project = await _find_project_by_cwd(cwd)
    if project:
        pending = await Task.where('project_id', project.id).where('status', 'pending').first()
        if pending:
            await Task.where('id', pending.id).update({'status': 'in_progress'})

    return JSONResponse({}, status_code=200)


async def claude_stopped(request: Request):
    """
    Receives the Claude Code Stop hook POST.
    Payload includes: session_id, cwd, hook_event_name, stop_hook_active, etc.
    We use `cwd` to find the active WebSocket and notify the frontend.
    After marking idle, picks up the next pending task (if any) and sends it to Claude.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    cwd = body.get('cwd', '')

    if not cwd:
        return JSONResponse({}, status_code=200)

    # Find the project by path and mark as idle
    project = await _find_project_by_cwd(cwd)
    if project:
        await Project.where('id', project.id).update({'claude_status': 'idle'})

    # Check for pending tasks and process the next one
    if project:
        next_task = await Task.where('project_id', project.id).where('status', 'pending').first()
        if next_task:
            await Task.where('id', next_task.id).update({'status': 'in_progress'})
            write = pty_writers.get(cwd)
            if write:
                # Give Claude a moment to return to the prompt before sending input
                await asyncio.sleep(0.5)
                write(next_task.description + '\n')
                await Project.where('id', project.id).update({'claude_status': 'running'})

                # Notify the frontend that a new task started
                ws = connections.get(cwd)
                if ws:
                    try:
                        await ws.send_text(json.dumps({
                            'type': 'task_started',
                            'cwd': cwd,
                            'task_id': next_task.id,
                            'description': next_task.description,
                        }))
                    except Exception:
                        pass
                return JSONResponse({}, status_code=200)

    # Deliver pending agent relay messages to any agents with active PTYs
    if project:
        await _deliver_agent_relay_messages(project, cwd)

    # Notify the connected frontend WebSocket for this project
    ws = connections.get(cwd)
    if ws:
        try:
            await ws.send_text(json.dumps({'type': 'claude_stopped', 'cwd': cwd}))
        except Exception:
            pass

    return JSONResponse({}, status_code=200)


async def _deliver_agent_relay_messages(project, cwd: str) -> None:
    """
    After any Claude instance stops, check for pending relay messages
    for all agents in the project and inject them into active PTYs.
    This creates the continuous back-and-forth flow between agents.
    """
    agents = await Agent.where('project_id', project.id).get()
    if not agents:
        return

    for agent in agents:
        pending = await AgentRelayMessage.where('to_agent_id', agent.id)\
            .where('status', 'pending').order_by('id', 'asc').get()
        if not pending:
            continue

        conn_key = f"{cwd}:agent:{agent.id}"
        write_fn = pty_writers.get(conn_key)
        if not write_fn:
            continue

        # Small delay so Claude has time to return to the prompt
        await asyncio.sleep(1.0)

        for msg in pending:
            from_agent = await Agent.find(msg.from_agent_id)
            sender_name = from_agent.name if from_agent else f"Agent #{msg.from_agent_id}"
            text = f"[Message from Agent '{sender_name}']: {msg.content}\n"
            write_fn(text.encode())
            await AgentRelayMessage.where('id', msg.id).update({'status': 'delivered'})

        # Notify frontend about the delivered messages
        ws = connections.get(cwd)
        if ws:
            try:
                await ws.send_text(json.dumps({
                    'type': 'agent_relay_delivered',
                    'agent_id': agent.id,
                    'count': len(pending),
                }))
            except Exception:
                pass
