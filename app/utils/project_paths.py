"""Safe resolution of client-supplied paths inside a project's root directory."""

import os
from pathlib import Path

from fastapi.responses import JSONResponse

from app.models.Project import Project


class InvalidPath(Exception):
    pass


async def project_root(project_id: int) -> Path:
    project = await Project.find_or_fail(project_id)
    return Path(project.path).expanduser().resolve()


def resolve_project_path(root: Path, raw: str) -> tuple[str, Path]:
    """Return the lexically normalized relative path and its realpath.

    The lexical form is what gets echoed back (so a symlinked dir keeps its own path
    in the explorer tree); the realpath enforces containment and is what callers must
    operate on, so a symlink swapped after this check can't redirect them.
    """
    if "\x00" in raw or Path(raw).is_absolute():
        raise InvalidPath
    rel = os.path.normpath(raw) if raw else "."
    if rel == ".." or rel.startswith("../"):
        raise InvalidPath
    try:
        target = (root / rel).resolve()
    except OSError as e:
        raise InvalidPath from e
    if not target.is_relative_to(root):
        raise InvalidPath
    return ("" if rel == "." else Path(rel).as_posix()), target


def path_error_response(error: Exception) -> JSONResponse:
    if isinstance(error, PermissionError):
        return JSONResponse({"error": "Permission denied"}, status_code=403)
    if isinstance(error, (FileNotFoundError, NotADirectoryError, IsADirectoryError)):
        return JSONResponse({"error": "Not found"}, status_code=404)
    # InvalidPath plus any other OSError (ENAMETOOLONG, ELOOP, ...) means the
    # requested path itself is unusable.
    return JSONResponse({"error": "Invalid path"}, status_code=400)
