from typing import Annotated

from fastapi import Query
from fastapi.responses import JSONResponse

from app.requests.git_request import GitCommitIndexQuery, GitCommitStoreRequest, GitWorktreeQuery
from app.services.git_repository import GitRepository
from app.services.process import CommandError
from app.utils.git_responses import git_error_response


async def index(project_id: int, query: Annotated[GitCommitIndexQuery, Query()]):
    try:
        repo = await GitRepository.for_project(project_id, query.worktree)
        return {"commits": await repo.log(query.limit)}
    except CommandError as e:
        return git_error_response(e)


async def store(
    project_id: int, body: GitCommitStoreRequest, query: Annotated[GitWorktreeQuery, Query()]
):
    try:
        repo = await GitRepository.for_project(project_id, query.worktree)
        commit = await repo.commit(body.message)
        status = await repo.status()
    except CommandError as e:
        return git_error_response(e)
    return JSONResponse({**commit, "status": status.to_dict()}, status_code=201)
