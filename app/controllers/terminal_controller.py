import asyncio
import json
import os
import subprocess
import uuid

from fastapi import Query, WebSocket
from fastapi_startkit.application import app

from app.actions.agent_startup import wait_for_agent_cli
from app.actions.claude_hook_action import agent_env
from app.actions.relay_delivery import deliver_pending_relay_messages
from app.models.Agent import Agent
from app.models.Project import Project
from app.services.claude_config_dir import agent_config_dir
from app.services.gemini_cli import validate_gemini_cli
from app.services.handoff.state import is_handed_off
from app.terminal.agent_session import attach_client, live_terminal, own_session, spawn_lock
from app.terminal.claude_monitor import make_claude_session_monitor
from app.terminal.cli_supervisor import supervise_cli
from app.terminal.manager import TerminalManager
from app.terminal.readiness import mark_booting


def _build_identity_suffix(agent_id: int) -> str:
    """Return the system-prompt suffix that tells a WS-connected agent its own ID
    and the correct parameter name to use when calling send_message_to_agent."""
    return (
        f"\n\n## Your identity\nYour agent ID is {agent_id}. "
        f"When other agents ask you to report back, always use this ID as `sender_agent_id` in send_message_to_agent calls."
    )


def _is_git_repo(path: str) -> bool:
    """Return True if `path` is inside an existing git repository."""
    result = subprocess.run(
        ["git", "-C", path, "rev-parse", "--is-inside-work-tree"],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def _ensure_git_repo(path: str) -> None:
    """Ensure `path` is inside a git repository, running `git init` if not.

    Raises RuntimeError if git init fails, so callers can send a clean error
    to the client instead of letting the PTY crash unexpectedly.
    """
    if _is_git_repo(path):
        return  # Already a git repo — nothing to do.

    init_result = subprocess.run(
        ["git", "-C", path, "init"],
        capture_output=True,
        text=True,
    )
    if init_result.returncode != 0:
        raise RuntimeError(f"git init failed in {path!r}: {init_result.stderr.strip()}")


async def _ensure_repo_once(project: Project, path: str) -> None:
    """Ensure the project directory is a git repo, but only on the first launch.

    `is_repository` records that we have already ensured the directory is a
    repository — it is NOT a detection of a pre-existing repo. While the flag is
    false we run the (potentially init-ing) `_ensure_git_repo` and then flip it
    to true, so on every later launch we skip both the git ensure/init and this
    check entirely.

    Propagates RuntimeError from `_ensure_git_repo` (the flag stays false if the
    ensure fails, so it is retried on the next launch).
    """
    if project.is_repository:
        return

    _ensure_git_repo(path)
    await Project.where("id", project.id).update({"is_repository": True})


async def terminal_ws(websocket: WebSocket, project: str, agent_id: int = Query()):
    await websocket.accept()

    project_record = await Project.where("slug", project).first()
    if not project_record:
        await websocket.close(code=1008, reason="Project not found")
        return

    agent_record = await Agent.where("id", agent_id).where_null("deleted_at").first()
    if not agent_record:
        await websocket.close(code=1008, reason="Agent not found")
        return
    if is_handed_off(agent_record):
        await websocket.close(code=1008, reason="Agent was handed off")
        return

    cwd = os.path.expanduser(project_record.path)
    os.makedirs(cwd, exist_ok=True)

    # Ensure the project directory is a git repository before spawning the PTY.
    # claude requires git; without it the process crashes in confusing ways.
    # `_ensure_repo_once` runs this only on the first launch and then records it
    # via `is_repository`, so later launches skip the redundant check.
    try:
        await _ensure_repo_once(project_record, cwd)
    except RuntimeError as exc:
        await websocket.send_text(json.dumps({"type": "error", "message": str(exc)}))
        await websocket.close(code=1011, reason="git init failed")
        return

    async with spawn_lock(agent_record.id):
        agent_record = await Agent.where("id", agent_id).where_null("deleted_at").first()
        if not agent_record:
            await websocket.close(code=1008, reason="Agent not found")
            return
        session_id = agent_record.session_id
        terminal = live_terminal(session_id)
        if terminal is None:
            session_id = await _spawn_agent_session(websocket, agent_record, project_record, cwd)
            terminal = live_terminal(session_id)
    if terminal is None:
        return

    await attach_client(websocket, session_id, terminal, cwd)


async def _spawn_agent_session(
    websocket: WebSocket, agent_record: Agent, project_record: Project, cwd: str
) -> str | None:
    try:
        await asyncio.to_thread(validate_gemini_cli, agent_record.provider)
    except RuntimeError as exc:
        await websocket.send_text(json.dumps({"type": "error", "message": str(exc)}))
        await websocket.close(code=1011, reason="provider unavailable")
        return None

    session_id = str(uuid.uuid4())
    await Agent.where("id", agent_record.id).update({"session_id": session_id})

    from app.controllers.agent_trigger_controller import ensure_agent_worktree

    try:
        agent_cwd = await asyncio.to_thread(
            ensure_agent_worktree, agent_record, cwd, project_record.worktree_copy_paths
        )
    except RuntimeError as exc:
        await Agent.where("id", agent_record.id).update({"session_id": None})
        await websocket.send_text(json.dumps({"type": "error", "message": str(exc)}))
        await websocket.close(code=1011, reason="worktree creation failed")
        return None

    terminal_manager: TerminalManager = app().make("terminal")
    config_dir = await agent_config_dir(agent_record, project_record)
    terminal_manager.create(
        cwd=agent_cwd, session_id=session_id, env=agent_env(agent_record.id, config_dir)
    )
    terminal = terminal_manager.get(session_id)

    ready_event = mark_booting(session_id)
    asyncio.create_task(_signal_ready_and_relay(ready_event, agent_record.id, terminal))

    def build_cmd(a):
        return a.to_command(system_prompt_suffix=_build_identity_suffix(a.id))

    monitor = make_claude_session_monitor(
        agent_id=agent_record.id,
        confirm_output=agent_record.provider != "gemini",
        terminal=terminal,
        terminal_manager=terminal_manager,
        session_id=session_id,
        build_cmd=build_cmd,
    )
    supervisor = supervise_cli(agent_record.id, terminal, session_id, build_cmd)
    own_session(
        agent_record.id,
        session_id,
        terminal,
        on_output=monitor,
        auto_send=supervisor.launch_line(build_cmd(agent_record)).encode() + b"\n",
    )
    return session_id


async def _signal_ready_and_relay(event: asyncio.Event, agent_id: int, terminal) -> None:
    await wait_for_agent_cli(terminal, agent_id)
    event.set()
    await deliver_pending_relay_messages(agent_id)
