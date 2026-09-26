from fastapi.responses import JSONResponse

from app.requests.git_request import PullRequestStoreRequest
from app.services.git_repository import GitRepository, NotARepository
from app.services.github_cli import GhUnavailable, GitHubCli
from app.services.process import CommandError
from app.utils.git_responses import git_error_response


async def show(project_id: int):
    # Always 200: the panel renders `error` in place of the PR row rather than failing.
    try:
        repo = await GitRepository.for_project(project_id)
        pull_request = await GitHubCli(repo).current_pull_request()
    except (GhUnavailable, NotARepository) as e:
        return {"available": False, "error": e.message, "pull_request": None}
    except CommandError as e:
        return {"available": True, "error": e.message, "pull_request": None}
    return {"available": True, "error": None, "pull_request": pull_request}


async def store(project_id: int, body: PullRequestStoreRequest):
    try:
        repo = await GitRepository.for_project(project_id)
        pull_request = await GitHubCli(repo).create_pull_request(
            body.title, body.body, body.base, body.draft
        )
    except CommandError as e:
        return git_error_response(e)
    return JSONResponse({"pull_request": pull_request}, status_code=201)
