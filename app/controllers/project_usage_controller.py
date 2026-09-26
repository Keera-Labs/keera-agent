import asyncio

from app.models.Agent import Agent
from app.models.AgentUsageReport import AgentUsageReport
from app.models.Project import Project
from app.resources.project_usage_resource import ProjectUsageResource
from app.services.claude_usage import ProjectUsage, claude_usage
from app.services.codex_usage import codex_usage


async def show(project_id: int) -> ProjectUsageResource:
    project = await Project.find_or_fail(project_id)
    # Transcripts can be large; parse them off the event loop.
    usage = await asyncio.to_thread(_token_usage, project.id, project.path)
    agent_ids = [agent.id for agent in await Agent.where("project_id", project.id).get()]
    reports = (
        await AgentUsageReport.where_in("agent_id", agent_ids).order_by("updated_at", "desc").get()
        if agent_ids
        else []
    )
    return ProjectUsageResource(usage, list(reports))


def _token_usage(project_id: int, project_path: str) -> ProjectUsage:
    claude = claude_usage.project_usage(project_id, project_path)
    return claude.merge(codex_usage.project_usage(project_id, project_path))
