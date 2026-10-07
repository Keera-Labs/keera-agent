import asyncio
import os
from pathlib import Path
from typing import Annotated

from fastapi import Query

from app.controllers import editor_settings_controller
from app.requests.editor_settings_request import EditorSettingsRequest
from app.requests.project_file_request import ProjectFileIndexRequest
from app.utils.file_filters import filter_entries
from app.utils.project_paths import (
    InvalidPath,
    path_error_response,
    project_root,
    resolve_project_path,
)

MAX_ENTRIES = 5000


def _entry_type(entry: os.DirEntry, root: Path) -> str:
    # A symlink leaving the project (or one that can't be resolved, e.g. a loop) is
    # reported as a plain file so the explorer never offers to expand it.
    try:
        if entry.is_symlink() and not Path(entry.path).resolve().is_relative_to(root):
            return "file"
        return "dir" if entry.is_dir() else "file"
    except OSError:
        return "file"


def _list_entries(
    root: Path, target: Path, rel: str, settings: EditorSettingsRequest
) -> list[dict]:
    with os.scandir(target) as it:
        entries = [
            {
                "name": entry.name,
                "path": f"{rel}/{entry.name}" if rel else entry.name,
                "type": _entry_type(entry, root),
            }
            for entry in it
        ]
    entries = filter_entries(entries, target, settings)
    entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower(), e["name"]))
    return entries


async def index(project_id: int, query: Annotated[ProjectFileIndexRequest, Query()]):
    root = await project_root(project_id)
    settings = await editor_settings_controller.current()

    try:
        rel, target = resolve_project_path(root, query.path)
        entries = await asyncio.to_thread(_list_entries, root, target, rel, settings)
    except (InvalidPath, OSError) as e:
        return path_error_response(e)

    return {"path": rel, "entries": entries[:MAX_ENTRIES], "truncated": len(entries) > MAX_ENTRIES}
