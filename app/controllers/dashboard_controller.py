import datetime

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Agent import Agent
from app.models.AgentRelayMessage import AgentRelayMessage
from app.models.Project import Project
from app.models.Workspace import Workspace

# Human-readable role per agent type (mirrors AGENT_TYPE_LABELS on the frontend
# but spelled out for the dashboard's "Working now" cards).
AGENT_TYPE_ROLES = {
    "pm": "Project Manager",
    "software_engineer": "Software Engineer",
    "software_engineer_frontend": "Frontend Engineer",
    "reviewer": "Code Reviewer",
    "qa": "QA",
}

# Cap the avatars rendered per project card; the rest collapse into a "+N" chip.
MAX_PROJECT_AVATARS = 4


def _initials(name: str | None) -> str:
    return (name or "?")[:2].upper()


def _parse_dt(value) -> datetime.datetime | None:
    if not value:
        return None
    if isinstance(value, datetime.datetime):
        return value
    try:
        return datetime.datetime.fromisoformat(str(value))
    except (ValueError, TypeError):
        return None


def _elapsed(started_at) -> str:
    """Compact running timer since ``started_at`` (e.g. "8m 12s")."""
    dt = _parse_dt(started_at)
    if dt is None:
        return ""
    seconds = max(0, int((datetime.datetime.now() - dt).total_seconds()))
    if seconds < 60:
        return f"{seconds}s"
    minutes, secs = divmod(seconds, 60)
    if minutes < 60:
        return f"{minutes}m {secs:02d}s"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h {minutes:02d}m"


def _ago(dt: datetime.datetime | None) -> str:
    """Relative label for the most recent activity in a project."""
    if dt is None:
        return "—"
    seconds = max(0, int((datetime.datetime.now() - dt).total_seconds()))
    if seconds < 45:
        return "just now"
    if seconds < 3600:
        return f"{round(seconds / 60)}m ago"
    if seconds < 86400:
        return f"{round(seconds / 3600)}h ago"
    return f"{round(seconds / 86400)}d ago"


def _agent_state(agent: Agent, has_pending: bool) -> str:
    """Bucket an agent into active | waiting | queued | done from real signals.

    - active:  the agent's Claude process is executing (status == running).
    - queued:  work is waiting for it — an undelivered relay message — but it
               isn't running yet.
    - waiting: it ran and is now idle at its prompt (status == waiting).
    - done:    idle with nothing queued.
    """
    status = getattr(agent, "status", "idle")
    if status == "running":
        return "active"
    if has_pending:
        return "queued"
    if status == "waiting":
        return "waiting"
    return "done"


async def index(request: Request):
    """Aggregate real agent/project activity for the workspace dashboard.

    Optional ``?workspace_id=`` scopes to one workspace; without it the view
    aggregates every project.
    """
    workspace_id_raw = request.query_params.get("workspace_id")
    workspace = None
    if workspace_id_raw:
        try:
            workspace = await Workspace.find(int(workspace_id_raw))
        except (ValueError, TypeError):
            workspace = None

    if workspace:
        projects = await Project.where("workspace_id", workspace.id).order_by("id", "asc").get()
        workspace_name = workspace.name
    else:
        projects = await Project.order_by("id", "asc").get()
        workspace_name = "All Projects"

    project_payloads = []
    working_now = []
    totals = {"active": 0, "waiting": 0, "queued": 0}
    agent_count = 0

    for project in projects:
        agents = (
            await Agent.where("project_id", project.id)
            .where_null("deleted_at")
            .order_by("id", "asc")
            .get()
        )

        counts = {"active": 0, "waiting": 0, "queued": 0, "done": 0}
        avatars = []
        latest_started: datetime.datetime | None = None

        for agent in agents:
            agent_count += 1

            has_pending = await (
                AgentRelayMessage.where("to_agent_id", agent.id).where("status", "pending").exists()
            )
            state = _agent_state(agent, bool(has_pending))
            counts[state] += 1

            if len(avatars) < MAX_PROJECT_AVATARS:
                avatars.append({"initials": _initials(agent.name), "agentType": agent.agent_type})

            started = _parse_dt(getattr(agent, "started_at", None))
            if started and (latest_started is None or started > latest_started):
                latest_started = started

            if state == "active":
                totals["active"] += 1
                working_now.append(
                    {
                        "id": agent.id,
                        "name": agent.name,
                        "initials": _initials(agent.name),
                        "agentType": agent.agent_type,
                        "role": AGENT_TYPE_ROLES.get(agent.agent_type, agent.agent_type),
                        "description": getattr(agent, "current_activity", None)
                        or agent.description
                        or "Working…",
                        "project": project.name,
                        "elapsed": _elapsed(getattr(agent, "started_at", None)),
                    }
                )
            elif state == "waiting":
                totals["waiting"] += 1
            elif state == "queued":
                totals["queued"] += 1

        online = (
            counts["active"] > 0
            or counts["waiting"] > 0
            or getattr(project, "claude_status", None) == "running"
        )

        project_payloads.append(
            {
                "id": project.id,
                "name": project.name,
                "online": online,
                "agents": avatars,
                "extraAgents": max(0, len(agents) - MAX_PROJECT_AVATARS),
                "activeCount": counts["active"],
                "waitingCount": counts["waiting"],
                "queuedCount": counts["queued"],
                "doneCount": counts["done"],
                "lastActivity": _ago(latest_started),
            }
        )

    return JSONResponse(
        {
            "workspaceName": workspace_name,
            "agentCount": agent_count,
            "projectCount": len(projects),
            "stats": {
                "projects": len(projects),
                "active": totals["active"],
                "waiting": totals["waiting"],
                "queued": totals["queued"],
            },
            "workingNow": working_now,
            "projects": project_payloads,
        }
    )
