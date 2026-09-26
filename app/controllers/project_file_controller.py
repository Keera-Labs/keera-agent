import asyncio
import os
from pathlib import Path
from typing import Annotated

from fastapi import Query
from fastapi.responses import JSONResponse

from app.models.Project import Project
from app.requests.project_file_request import ProjectFileIndexRequest


class _InvalidPath(Exception):
    pass


def _normalize(root: Path, raw: str) -> str:
    """Return the lexically normalized relative path, or raise if it escapes the root.

    The lexical form is what gets echoed back (so a symlinked dir keeps its own path
    in the explorer tree); the realpath check is what actually enforces containment.
    """
    if "\x00" in raw or Path(raw).is_absolute():
        raise _InvalidPath
    rel = os.path.normpath(raw) if raw else "."
    if rel == ".." or rel.startswith("../"):
        raise _InvalidPath
    if not (root / rel).resolve().is_relative_to(root):
        raise _InvalidPath
    return "" if rel == "." else Path(rel).as_posix()


def _entry_type(entry: os.DirEntry, root: Path) -> str:
    # A symlink leaving the project is reported as a plain file so the explorer
    # never offers to expand it.
    if entry.is_symlink() and not Path(entry.path).resolve().is_relative_to(root):
        return "file"
    return "dir" if entry.is_dir() else "file"


def _list_entries(root: Path, rel: str) -> list[dict]:
    with os.scandir(root / rel) as it:
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
        rel = _normalize(root, query.path)
    except _InvalidPath:
        return JSONResponse({"error": "Invalid path"}, status_code=400)

    if not (root / rel).is_dir():
        return JSONResponse({"error": "Directory not found"}, status_code=404)

    try:
        entries = await asyncio.to_thread(_list_entries, root, rel)
    except PermissionError:
        return JSONResponse({"error": "Permission denied"}, status_code=403)

    return {"path": rel, "entries": entries}
