from fastapi.responses import JSONResponse

from app.models.Project import Project
from app.requests.project_worktree_file_request import ProjectWorktreeFileUpdateRequest


def _paths_response(project: Project) -> JSONResponse:
    return JSONResponse({"data": {"paths": project.worktree_copy_paths or []}})


async def show(project_id: int):
    return _paths_response(await Project.find_or_fail(project_id))


async def update(project_id: int, body: ProjectWorktreeFileUpdateRequest):
    project = await Project.find_or_fail(project_id)
    project.worktree_copy_paths = body.paths
    await project.save()
    return _paths_response(await Project.find_or_fail(project_id))
