from typing import Annotated

from fastapi import Query

from app.requests.git_request import GitPathsRequest, GitWorktreeQuery
from app.services.git_repository import GitRepository
from app.services.process import CommandError
from app.utils.git_responses import git_error_response


async def store(
    project_id: int, body: GitPathsRequest, query: Annotated[GitWorktreeQuery, Query()]
):
    try:
        repo = await GitRepository.for_project(project_id, query.worktree)
        await repo.stage(body.selected_paths())
        return (await repo.status()).to_dict()
    except CommandError as e:
        return git_error_response(e)


async def destroy(
    project_id: int, body: GitPathsRequest, query: Annotated[GitWorktreeQuery, Query()]
):
    try:
        repo = await GitRepository.for_project(project_id, query.worktree)
        await repo.unstage(body.selected_paths())
        return (await repo.status()).to_dict()
    except CommandError as e:
        return git_error_response(e)
