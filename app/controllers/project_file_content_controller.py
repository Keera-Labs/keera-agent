import asyncio
import hashlib
import os
import stat
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import Query
from fastapi.responses import JSONResponse

from app.requests.project_file_request import (
    ProjectFileContentQuery,
    ProjectFileContentUpdateRequest,
)
from app.utils.project_paths import (
    InvalidPath,
    path_error_response,
    project_root,
    resolve_project_path,
)

MAX_BYTES = 2 * 1024 * 1024

# Serializes etag-check + replace so two concurrent saves of the same etag can't
# both pass the check and silently overwrite each other.
_write_lock = asyncio.Lock()


class FileTooLarge(Exception):
    pass


class NotText(Exception):
    pass


class EtagMismatch(Exception):
    def __init__(self, etag: str):
        self.etag = etag


def _etag(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_regular_file(target: Path) -> tuple[bytes, os.stat_result]:
    # O_NONBLOCK + fstat on the opened fd: a FIFO swapped in after path resolution
    # can't block the open, and is rejected before anything is read from it.
    fd = os.open(target, os.O_RDONLY | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as f:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise IsADirectoryError
        if st.st_size > MAX_BYTES:
            raise FileTooLarge
        data = f.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise FileTooLarge
    return data, st


def _read_text(target: Path) -> tuple[str, bytes]:
    data, _ = _read_regular_file(target)
    if b"\x00" in data:
        raise NotText
    try:
        return data.decode("utf-8"), data
    except UnicodeDecodeError as e:
        raise NotText from e


def _ensure_editable(target: Path) -> None:
    # Cheap pre-check outside the write lock so a save against a missing, non-regular
    # or oversized file is rejected without ever queueing behind other saves.
    st = target.stat()
    if not stat.S_ISREG(st.st_mode):
        raise IsADirectoryError
    if st.st_size > MAX_BYTES:
        raise FileTooLarge


def _replace_atomically(target: Path, data: bytes, expected_etag: str) -> None:
    current, st = _read_regular_file(target)
    if _etag(current) != expected_etag:
        raise EtagMismatch(_etag(current))

    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, stat.S_IMODE(st.st_mode))
        os.replace(tmp, target)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _error_response(error: Exception) -> JSONResponse:
    if isinstance(error, FileTooLarge):
        return JSONResponse({"error": "File exceeds 2 MB"}, status_code=413)
    if isinstance(error, NotText):
        return JSONResponse({"error": "File is not UTF-8 text"}, status_code=415)
    if isinstance(error, EtagMismatch):
        return JSONResponse(
            {"error": "File changed since it was read", "etag": error.etag}, status_code=409
        )
    return path_error_response(error)


async def show(project_id: int, query: Annotated[ProjectFileContentQuery, Query()]):
    root = await project_root(project_id)

    try:
        rel, target = resolve_project_path(root, query.path)
        content, data = await asyncio.to_thread(_read_text, target)
    except (InvalidPath, OSError, FileTooLarge, NotText) as e:
        return _error_response(e)

    return {
        "path": rel,
        "content": content,
        "etag": _etag(data),
        "size": len(data),
        "encoding": "utf-8",
    }


async def update(
    project_id: int,
    query: Annotated[ProjectFileContentQuery, Query()],
    body: ProjectFileContentUpdateRequest,
):
    root = await project_root(project_id)
    data = body.content.encode("utf-8")

    try:
        rel, target = resolve_project_path(root, query.path)
        if len(data) > MAX_BYTES:
            raise FileTooLarge
        await asyncio.to_thread(_ensure_editable, target)
        async with _write_lock:
            await asyncio.to_thread(_replace_atomically, target, data, body.etag)
    except (InvalidPath, OSError, FileTooLarge, EtagMismatch) as e:
        return _error_response(e)

    return {"path": rel, "etag": _etag(data), "size": len(data)}
