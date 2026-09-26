from typing import Annotated

from fastapi import Query
from fastapi.responses import JSONResponse

from app.requests.git_request import GitWorktreeQuery, PullRequestStoreRequest
from app.services.git_repository import GitRepository, InvalidWorktree, NotARepository
from app.services.github_cli import GhUnavailable, GitHubCli
from app.services.process import CommandError
from app.utils.git_responses import git_error_response


async def show(project_id: int, query: Annotated[GitWorktreeQuery, Query()]):
    # Repo/gh problems stay 200: the panel renders `error` in place of the PR row.
    # A bad worktree selector is a client error, so it is the one exception.
    try:
        repo = await GitRepository.for_project(project_id, query.worktree)
        pull_request = await GitHubCli(repo).current_pull_request()
    except InvalidWorktree as e:
        return git_error_response(e)
    except (GhUnavailable, NotARepository) as e:
        return {"available": False, "error": e.message, "pull_request": None}
    except CommandError as e:
        return {"available": True, "error": e.message, "pull_request": None}
    return {"available": True, "error": None, "pull_request": pull_request}


async def store(
    project_id: int, body: PullRequestStoreRequest, query: Annotated[GitWorktreeQuery, Query()]
):
    try:
        repo = await GitRepository.for_project(project_id, query.worktree)
        pull_request = await GitHubCli(repo).create_pull_request(
            body.title, body.body, body.base, body.draft
        )
    except CommandError as e:
        return git_error_response(e)
    return JSONResponse({"pull_request": pull_request}, status_code=201)
