from typing import Annotated

from fastapi import Query

from app.requests.git_request import GitDiffQuery
from app.services.git_diff import file_diff
from app.services.git_repository import GitRepository
from app.services.process import CommandError
from app.utils.git_responses import git_error_response


async def show(project_id: int, query: Annotated[GitDiffQuery, Query()]):
    try:
        repo = await GitRepository.for_project(project_id, query.worktree)
        return (await file_diff(repo, query.path, query.staged)).to_dict()
    except CommandError as e:
        return git_error_response(e)
