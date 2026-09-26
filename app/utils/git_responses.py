from fastapi.responses import JSONResponse

from app.services.git_repository import InvalidRepoPath
from app.services.github_cli import GhUnavailable
from app.services.process import CommandError


def git_error_response(error: CommandError) -> JSONResponse:
    if isinstance(error, InvalidRepoPath):
        status = 422
    elif isinstance(error, GhUnavailable):
        status = 503
    else:
        status = 409
    return JSONResponse({"detail": error.message}, status_code=status)
