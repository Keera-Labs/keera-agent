import asyncio

from app.models.Agent import Agent
from app.models.AgentUsageReport import AgentUsageReport
from app.models.Project import Project
from app.resources.project_usage_resource import ProjectUsageResource
from app.services.claude_config_dir import project_config_dir
from app.services.claude_usage import ProjectUsage, claude_usage
from app.services.codex_usage import codex_usage


async def show(project_id: int) -> ProjectUsageResource:
    project = await Project.find_or_fail(project_id)
    # Transcripts can be large; parse them off the event loop.
    config_dir = await project_config_dir(project)
    usage = await asyncio.to_thread(_token_usage, project.id, project.path, config_dir)
    agent_ids = [agent.id for agent in await Agent.where("project_id", project.id).get()]
    reports = (
        await AgentUsageReport.where_in("agent_id", agent_ids).order_by("updated_at", "desc").get()
        if agent_ids
        else []
    )
    return ProjectUsageResource(usage, list(reports))


def _token_usage(project_id: int, project_path: str, config_dir: str | None) -> ProjectUsage:
    claude = claude_usage.project_usage(project_id, project_path, config_dir=config_dir)
    return claude.merge(codex_usage.project_usage(project_id, project_path))
