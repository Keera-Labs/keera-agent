from typing import Annotated

from fastapi import Query

from app.requests.git_request import GitWorktreeQuery
from app.services.git_repository import GitRepository, InvalidWorktree, RepositoryStatus
from app.services.process import CommandError
from app.utils.git_responses import git_error_response
from app.utils.project_paths import project_root


async def show(project_id: int, query: Annotated[GitWorktreeQuery, Query()]):
    # A project that isn't a git repo is a normal state for the panel, not an error.
    repo = await GitRepository.discover(await project_root(project_id))
    if repo is None:
        if query.worktree:
            return git_error_response(InvalidWorktree(query.worktree))
        return RepositoryStatus().to_dict()
    try:
        if query.worktree:
            repo = await repo.select_worktree(query.worktree)
        return (await repo.status()).to_dict()
    except CommandError as e:
        return git_error_response(e)
