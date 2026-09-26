import asyncio

from app.models.Project import Project
from app.resources.project_usage_resource import ProjectUsageResource
from app.services.claude_usage import claude_usage


async def show(project_id: int) -> ProjectUsageResource:
    project = await Project.find_or_fail(project_id)
    # Transcripts can be large; parse them off the event loop.
    usage = await asyncio.to_thread(claude_usage.project_usage, project.id, project.path)
    return ProjectUsageResource(usage)
