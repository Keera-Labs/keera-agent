from fastapi.responses import JSONResponse

from app.services.git_repository import (
    ChangeNotFound,
    InvalidBase,
    InvalidRepoPath,
    InvalidWorktree,
    MainWorktreeRemoval,
)
from app.services.github_cli import GhUnavailable
from app.services.process import CommandError


def git_error_status(error: CommandError) -> int:
    if isinstance(error, (InvalidBase, InvalidRepoPath, InvalidWorktree, MainWorktreeRemoval)):
        return 422
    if isinstance(error, ChangeNotFound):
        return 404
    if isinstance(error, GhUnavailable):
        return 503
    return 409


def git_error_response(error: CommandError) -> JSONResponse:
    return JSONResponse({"detail": error.message}, status_code=git_error_status(error))
