from typing import Annotated

from fastapi import Query

from app.requests.git_request import GitWorktreeQuery
from app.services.git_repository import GitRepository
from app.services.process import CommandError
from app.utils.git_responses import git_error_response


async def index(project_id: int, query: Annotated[GitWorktreeQuery, Query()]):
    try:
        repo = await GitRepository.for_project(project_id, query.worktree)
        branches, default_base = await repo.branches(), await repo.default_base_name()
    except CommandError as e:
        return git_error_response(e)
    return {"branches": branches, "default_base": default_base}
