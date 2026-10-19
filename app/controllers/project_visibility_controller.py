from app.models.Project import Project
from app.requests.project_visibility_request import ProjectVisibilityUpdateRequest
from app.resources.project_resource import ProjectResource


async def update(request: ProjectVisibilityUpdateRequest, project_id: int) -> ProjectResource:
    """Hide a project from the sidebar (NULL timestamp) or bring it back to the top."""
    project = await Project.find_or_fail(project_id)

    await project.update({"last_opened_at": None if request.hidden else Project.now()})

    return ProjectResource(project)
