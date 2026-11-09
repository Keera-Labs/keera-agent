import datetime
import logging
import os
from enum import StrEnum

from fastapi_startkit.application import app

from app.actions.agent_status_action import utc_now
from app.models.Agent import Agent
from app.models.Project import Project
from app.models.Task import Task
from app.services.worktree_probe import WorktreeSnapshot, probe_agent_worktrees

HEALTHY_WINDOW = datetime.timedelta(seconds=90)
STALL_WINDOW = datetime.timedelta(minutes=5)
HEARTBEAT_NOTE_LENGTH = 140

logger = logging.getLogger(__name__)


class AgentHealth(StrEnum):
    HEALTHY = "healthy"
    QUIET = "quiet"
    STALLED = "stalled"
    DEAD = "dead"


def _as_utc(value) -> datetime.datetime | None:
    if not value:
        return None
    try:
        moment = (
            value
            if isinstance(value, datetime.datetime)
            else datetime.datetime.fromisoformat(str(value))
        )
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=datetime.UTC)


def _stamp(moment: datetime.datetime | None) -> str | None:
    return moment.astimezone(datetime.UTC).strftime("%Y-%m-%d %H:%M:%S") if moment else None


def has_live_session(agent: Agent) -> bool:
    session_id = getattr(agent, "session_id", None)
    return bool(session_id) and app().make("terminal").find(session_id) is not None


def last_heartbeat(agent: Agent) -> datetime.datetime | None:
    return _as_utc(getattr(agent, "last_heartbeat_at", None)) or _as_utc(agent.created_at)


def agent_health(
    agent: Agent, live_session: bool, now: datetime.datetime | None = None
) -> AgentHealth:
    if not live_session:
        return AgentHealth.DEAD
    now = now or datetime.datetime.now(datetime.UTC)
    heartbeat = last_heartbeat(agent)
    if heartbeat and now - heartbeat < HEALTHY_WINDOW:
        return AgentHealth.HEALTHY
    changed = _as_utc(getattr(agent, "worktree_last_change_at", None))
    if (heartbeat and now - heartbeat < STALL_WINDOW) or (changed and now - changed < STALL_WINDOW):
        return AgentHealth.QUIET
    return AgentHealth.STALLED


def heartbeat_age(agent: Agent, now: datetime.datetime | None = None) -> str:
    heartbeat = _as_utc(getattr(agent, "last_heartbeat_at", None))
    if heartbeat is None:
        return "never"
    seconds = int(((now or datetime.datetime.now(datetime.UTC)) - heartbeat).total_seconds())
    return f"{seconds}s ago" if seconds < 120 else f"{seconds // 60}m ago"


async def record_heartbeat(agent_id: int, note: str | None = None) -> None:
    values = {"last_heartbeat_at": utc_now()}
    if note is not None:
        values["heartbeat_note"] = note.strip()[:HEARTBEAT_NOTE_LENGTH] or None
    await Agent.where("id", agent_id).where_null("deleted_at").update(values)


async def probe_agent(agent: Agent) -> WorktreeSnapshot | None:
    project = await Project.find(agent.project_id)
    if not project:
        return None
    task = await Task.find(agent.task_id) if getattr(agent, "task_id", None) else None
    snapshot = await probe_agent_worktrees(
        os.path.expanduser(project.path), agent.id, task.branch if task else None
    )
    if snapshot is None:
        return None
    await Agent.where("id", agent.id).update(
        {
            "worktree_branch": snapshot.branch,
            "worktree_head_sha": snapshot.head_sha,
            "worktree_last_commit_at": _stamp(snapshot.last_commit_at),
            "worktree_last_change_at": _stamp(snapshot.last_change_at),
        }
    )
    return snapshot


async def probe_live_agents() -> None:
    agents = await Agent.where_null("deleted_at").where_not_null("session_id").get()
    for agent in agents:
        try:
            await probe_agent(agent)
        except Exception:
            logger.exception("Worktree probe failed for agent %s", agent.id)
