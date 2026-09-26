import datetime
import json
import os
import re

from fastapi_startkit.application import app

from app.models.Agent import Agent
from app.models.Project import Project
from app.terminal.connection_manager import ConnectionManager

# `claude --worktree agent-<id>` runs the agent in <project>/.claude/worktrees/agent-<id>.
_WORKTREE_AGENT = re.compile(r"/\.claude/worktrees/agent-(\d+)(?:/|$)")

CLEARED_ATTENTION = {"attention_kind": None, "attention_prompt": None}


def hook_agent_id(header: str | None, cwd: str | None = None) -> int | None:
    """The agent a hook came from: the agent-id header, else an agent worktree cwd.

    The header is empty (or the literal `$KEERA_AGENT_ID`) when the hook fires in a
    terminal keera did not spawn for an agent, so anything non-numeric is ignored.
    """
    if header and header.strip().isdigit():
        return int(header.strip())
    match = _WORKTREE_AGENT.search(cwd or "")
    return int(match.group(1)) if match else None


async def find_hook_agent(header: str | None, cwd: str | None = None) -> Agent | None:
    agent_id = hook_agent_id(header, cwd)
    if agent_id is None:
        return None
    return await Agent.where("id", agent_id).where_null("deleted_at").first()


def utc_now() -> str:
    # Builder updates skip the timestamp observer; the sidebar reads updated_at as the
    # agent's last activity.
    return datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M:%S")


async def notify_agent_status(agent: Agent, status: str) -> None:
    """Tell open frontend terminals of the agent's project to refresh agent statuses."""
    project = await Project.find(agent.project_id)
    if not project:
        return
    conn_manager: ConnectionManager = app().make("connections")
    payload = json.dumps({"type": "agent_status", "agent_id": agent.id, "status": status})
    for bridge in conn_manager.all_for_cwd(os.path.expanduser(project.path)):
        try:
            await bridge.write(payload)
        except Exception:
            pass
