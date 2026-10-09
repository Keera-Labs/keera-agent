from typing import Annotated

from fastapi import Query

from app.requests.git_request import GitWorktreeQuery
from app.services.git_repository import GitRepository, short_ref
from app.services.process import CommandError
from app.utils.git_responses import git_error_response


async def index(project_id: int, query: Annotated[GitWorktreeQuery, Query()]):
    try:
        repo = await GitRepository.for_project(project_id, query.worktree)
        branches, default = await repo.branches(), await repo.branch_base()
    except CommandError as e:
        return git_error_response(e)
    return {"branches": branches, "default_base": short_ref(default) if default else None}
