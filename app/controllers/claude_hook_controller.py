import asyncio
import datetime
import json
import os

from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi_startkit.application import app

from app.models.Agent import Agent
from app.models.AgentRelayMessage import AgentRelayMessage
from app.models.Project import Project
from app.models.Task import Task
from app.terminal.connection_manager import ConnectionManager
from app.terminal.manager import TerminalManager


def _find_project_bridge(project_cwd: str):
    """Return any active frontend bridge for the given project directory."""
    conn_manager: ConnectionManager = app().make("connections")
    return conn_manager.find_by_cwd(project_cwd)


async def _find_project_by_cwd(cwd: str):
    """Find a project whose path matches cwd, handling ~ vs absolute path differences.
    Also handles worktree paths (e.g. <project>/.claude/worktrees/agent-N)."""
    project = await Project.where("path", cwd).first()
    if project:
        return project
    all_projects = await Project.all()
    # Exact match after ~ expansion
    match = next((p for p in all_projects if os.path.expanduser(p.path) == cwd), None)
    if match:
        return match
    # Worktree path: cwd is <project_path>/.claude/worktrees/agent-N
    worktrees_suffix = os.path.join(".claude", "worktrees") + os.sep
    for p in all_projects:
        expanded = os.path.expanduser(p.path)
        if cwd.startswith(os.path.join(expanded, worktrees_suffix)):
            return p
    return None


async def claude_started(request: Request):
    """
    Receives the Claude Code UserPromptSubmit hook POST.
    Marks the first pending task for the project as started.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    cwd = body.get("cwd", "")
    if not cwd:
        return JSONResponse({}, status_code=200)

    project = await _find_project_by_cwd(cwd)
    if project:
        pending = await Task.where("project_id", project.id).where("status", "pending").first()
        if pending:
            await Task.where("id", pending.id).update({"status": "in_progress"})

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

    cwd = body.get("cwd", "")

    if not cwd:
        return JSONResponse({}, status_code=200)

    # Find the project by path and mark as idle
    project = await _find_project_by_cwd(cwd)
    if project:
        await Project.where("id", project.id).update({"claude_status": "idle"})

    # Use the project's actual stored path for connection/pty_writer lookups so that
    # worktree cwds (e.g. <project>/.claude/worktrees/agent-N) resolve correctly.
    project_cwd = os.path.expanduser(project.path) if project else cwd

    # Fire background work and return immediately so the hook client doesn't time out.
    # All deferred I/O (sleeps + PTY writes) runs in the background task.
    if project:
        asyncio.create_task(_handle_claude_stopped(project, project_cwd))

    return JSONResponse({}, status_code=200)


async def _handle_claude_stopped(project, project_cwd: str) -> None:
    """Background work after Claude stops — runs after HTTP 200 is already sent."""
    # Notify the frontend that Claude is idle
    bridge = _find_project_bridge(project_cwd)
    if bridge:
        try:
            await bridge.write(json.dumps({"type": "claude_stopped", "cwd": project_cwd}))
        except Exception:
            pass

    # Claude finished its turn for this project — any agent that was actively
    # running is now idle at its prompt (waiting for the next input).
    await (
        Agent.where("project_id", project.id)
        .where("status", "running")
        .update({"status": "waiting", "current_activity": None})
    )

    # Check for pending tasks and dispatch the next one
    next_task = await Task.where("project_id", project.id).where("status", "pending").first()
    if next_task:
        await Task.where("id", next_task.id).update({"status": "in_progress"})
        terminal_manager: TerminalManager = app().make("terminal")
        agents = await Agent.where("project_id", project.id).get()
        active_agent = next(
            (ag for ag in agents if ag.session_id and terminal_manager.find(ag.session_id)), None
        )
        if active_agent:
            await asyncio.sleep(0.5)
            task_text = (next_task.body or next_task.title).encode().rstrip(b"\r\n")
            await terminal_manager.write(active_agent.session_id, task_text)
            await asyncio.sleep(0.05)
            await terminal_manager.write(active_agent.session_id, b"\r")
            await Project.where("id", project.id).update({"claude_status": "running"})
            now = datetime.datetime.now().isoformat(sep=" ", timespec="seconds")
            await Agent.where("id", active_agent.id).update(
                {
                    "status": "running",
                    "started_at": now,
                    "current_activity": (next_task.body or next_task.title)[:140],
                }
            )

            bridge = _find_project_bridge(project_cwd)
            if bridge:
                try:
                    await bridge.write(
                        json.dumps(
                            {
                                "type": "task_started",
                                "cwd": project_cwd,
                                "task_id": next_task.id,
                                "body": next_task.body or next_task.title,
                            }
                        )
                    )
                except Exception:
                    pass

    # Deliver pending agent relay messages to any agents with active PTYs
    await _deliver_agent_relay_messages(project, project_cwd)


async def _deliver_agent_relay_messages(project, cwd: str) -> None:
    """
    After any Claude instance stops, check for pending relay messages
    for all agents in the project and inject them into active PTYs.
    This creates the continuous back-and-forth flow between agents.
    """
    agents = await Agent.where("project_id", project.id).get()
    if not agents:
        return

    for agent in agents:
        pending = (
            await AgentRelayMessage.where("to_agent_id", agent.id)
            .where("status", "pending")
            .order_by("id", "asc")
            .get()
        )
        if not pending:
            continue

        terminal_manager: TerminalManager = app().make("terminal")
        if not (agent.session_id and terminal_manager.find(agent.session_id)):
            continue

        # Small delay so Claude has time to return to the prompt
        await asyncio.sleep(1.0)

        for msg in pending:
            from_agent = await Agent.find(msg.from_agent_id)
            sender_name = from_agent.name if from_agent else f"Agent #{msg.from_agent_id}"
            relay_bytes = f"[Message from Agent '{sender_name}']: {msg.content}".encode().rstrip(
                b"\r\n"
            )
            await terminal_manager.write(agent.session_id, relay_bytes)
            await asyncio.sleep(0.05)
            await terminal_manager.write(agent.session_id, b"\r")
            await AgentRelayMessage.where("id", msg.id).update({"status": "delivered"})

        # Notify frontend about the delivered messages
        bridge = _find_project_bridge(cwd)
        if bridge:
            try:
                await bridge.write(
                    json.dumps(
                        {
                            "type": "agent_relay_delivered",
                            "agent_id": agent.id,
                            "count": len(pending),
                        }
                    )
                )
            except Exception:
                pass
