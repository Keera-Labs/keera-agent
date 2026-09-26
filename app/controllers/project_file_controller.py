import asyncio
import os
from pathlib import Path
from typing import Annotated

from fastapi import Query
from fastapi.responses import JSONResponse

from app.models.Project import Project
from app.requests.project_file_request import ProjectFileIndexRequest

MAX_ENTRIES = 5000


class _InvalidPath(Exception):
    pass


def _normalize(root: Path, raw: str) -> tuple[str, Path]:
    """Return the lexically normalized relative path and its realpath.

    The lexical form is what gets echoed back (so a symlinked dir keeps its own path
    in the explorer tree); the realpath is what enforces containment and is what gets
    listed, so a symlink swapped after this check can't redirect the scan.
    """
    if "\x00" in raw or Path(raw).is_absolute():
        raise _InvalidPath
    rel = os.path.normpath(raw) if raw else "."
    if rel == ".." or rel.startswith("../"):
        raise _InvalidPath
    try:
        target = (root / rel).resolve()
    except OSError as e:
        raise _InvalidPath from e
    if not target.is_relative_to(root):
        raise _InvalidPath
    return ("" if rel == "." else Path(rel).as_posix()), target


def _entry_type(entry: os.DirEntry, root: Path) -> str:
    # A symlink leaving the project (or one that can't be resolved, e.g. a loop) is
    # reported as a plain file so the explorer never offers to expand it.
    try:
        if entry.is_symlink() and not Path(entry.path).resolve().is_relative_to(root):
            return "file"
        return "dir" if entry.is_dir() else "file"
    except OSError:
        return "file"


def _list_entries(root: Path, target: Path, rel: str) -> list[dict]:
    with os.scandir(target) as it:
        entries = [
            {
                "name": entry.name,
                "path": f"{rel}/{entry.name}" if rel else entry.name,
                "type": _entry_type(entry, root),
            }
            for entry in it
        ]
    entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower(), e["name"]))
    return entries


async def index(project_id: int, query: Annotated[ProjectFileIndexRequest, Query()]):
    project = await Project.find_or_fail(project_id)
    root = Path(project.path).expanduser().resolve()

    try:
        rel, target = _normalize(root, query.path)
        entries = await asyncio.to_thread(_list_entries, root, target, rel)
    except (_InvalidPath, OSError) as e:
        return _error_response(e)

    return {"path": rel, "entries": entries[:MAX_ENTRIES], "truncated": len(entries) > MAX_ENTRIES}


def _error_response(error: Exception) -> JSONResponse:
    if isinstance(error, PermissionError):
        return JSONResponse({"error": "Permission denied"}, status_code=403)
    if isinstance(error, (FileNotFoundError, NotADirectoryError)):
        return JSONResponse({"error": "Directory not found"}, status_code=404)
    # _InvalidPath plus any other OSError (ENAMETOOLONG, ELOOP, ...) means the
    # requested path itself is unusable.
    return JSONResponse({"error": "Invalid path"}, status_code=400)
