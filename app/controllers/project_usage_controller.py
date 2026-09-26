import asyncio

from app.models.Agent import Agent
from app.models.AgentUsageReport import AgentUsageReport
from app.models.Project import Project
from app.resources.project_usage_resource import ProjectUsageResource
from app.services.claude_usage import claude_usage


async def show(project_id: int) -> ProjectUsageResource:
    project = await Project.find_or_fail(project_id)
    # Transcripts can be large; parse them off the event loop.
    usage = await asyncio.to_thread(claude_usage.project_usage, project.id, project.path)
    agent_ids = [agent.id for agent in await Agent.where("project_id", project.id).get()]
    reports = (
        await AgentUsageReport.where_in("agent_id", agent_ids).order_by("updated_at", "desc").get()
        if agent_ids
        else []
    )
    return ProjectUsageResource(usage, list(reports))
