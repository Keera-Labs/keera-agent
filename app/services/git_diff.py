"""Both sides of one file's change, shaped for a side-by-side diff editor."""

import asyncio
import os
import posixpath
from dataclasses import asdict, dataclass

from app.services.git_repository import ChangeNotFound, FileChange, GitRepository, InvalidRepoPath
from app.utils.project_paths import InvalidPath, resolve_project_path

MAX_SIDE_BYTES = 1024 * 1024
BINARY_SNIFF_BYTES = 8000

# Monaco language ids for common extensions; anything else is left for the editor to decide.
_LANGUAGES = {
    ".py": "python",
    ".pyi": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".vue": "html",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".less": "less",
    ".json": "json",
    ".md": "markdown",
    ".markdown": "markdown",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".toml": "ini",
    ".ini": "ini",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".sql": "sql",
    ".xml": "xml",
    ".svg": "xml",
    ".go": "go",
    ".rs": "rust",
    ".rb": "ruby",
    ".php": "php",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".lua": "lua",
    ".r": "r",
    ".dockerfile": "dockerfile",
}
_FILENAME_LANGUAGES = {"Dockerfile": "dockerfile", "Makefile": "makefile"}


class _TooLarge:
    pass


TOO_LARGE = _TooLarge()
Side = bytes | _TooLarge | None


@dataclass
class FileDiff:
    path: str
    original_path: str | None
    status: str
    staged: bool
    original: str | None = None
    modified: str | None = None
    binary: bool = False
    too_large: bool = False
    language: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def language_for(path: str) -> str | None:
    name = posixpath.basename(path)
    if name in _FILENAME_LANGUAGES:
        return _FILENAME_LANGUAGES[name]
    return _LANGUAGES.get(posixpath.splitext(name)[1].lower())


def _decode(data: bytes) -> str | None:
    """Text content, or None when the bytes look binary."""
    if b"\0" in data[:BINARY_SNIFF_BYTES]:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _read_working_file(repo: GitRepository, rel: str) -> Side:
    link = repo.root / rel
    # Git stores a symlink as its target text, so compare like with like.
    if link.is_symlink():
        return os.readlink(link).encode()
    try:
        _, target = resolve_project_path(repo.root, rel)
        if not target.is_file():
            return None
        if target.stat().st_size > MAX_SIDE_BYTES:
            return TOO_LARGE
        return target.read_bytes()
    except (InvalidPath, OSError):
        return None


async def _read_blob(repo: GitRepository, spec: str) -> Side:
    size = await repo.git("cat-file", "-s", spec)
    if not size.ok:
        return None
    if int(size.text.strip()) > MAX_SIDE_BYTES:
        return TOO_LARGE
    return (await repo.git_ok("cat-file", "blob", spec)).stdout


def _relative_path(raw: str) -> str:
    # Lexical only: the path must also be one git reports as changed, and the working
    # copy is read through resolve_project_path, so symlinks can't lead outside the repo.
    rel = posixpath.normpath(raw) if raw else "."
    if "\0" in raw or posixpath.isabs(rel) or rel in (".", "..") or rel.startswith("../"):
        raise InvalidRepoPath(raw)
    return rel


async def _find_change(repo: GitRepository, rel: str, staged: bool) -> FileChange:
    status = await repo.changed_files()
    for change in status.staged if staged else status.changes:
        if change.path == rel:
            return change
    raise ChangeNotFound(f"No {'staged' if staged else 'unstaged'} changes for {rel}")


async def _sides(repo: GitRepository, change: FileChange, staged: bool) -> tuple[Side, Side]:
    source = change.original_path or change.path
    if staged:
        original = None if change.status == "A" else await _read_blob(repo, f"HEAD:{source}")
        modified = None if change.status == "D" else await _read_blob(repo, f":0:{change.path}")
        return original, modified

    working = await asyncio.to_thread(_read_working_file, repo, change.path)
    if change.untracked:
        return None, working
    if change.unmerged:
        # The index holds conflict stages, not one blob, so show HEAD against the marked-up file.
        return await _read_blob(repo, f"HEAD:{change.path}"), working
    original = await _read_blob(repo, f":0:{source}")
    return original, None if change.status == "D" else working


async def file_diff(repo: GitRepository, path: str, staged: bool) -> FileDiff:
    change = await _find_change(repo, _relative_path(path), staged)
    diff = FileDiff(
        path=change.path,
        original_path=change.original_path,
        status=change.status,
        staged=staged,
        language=language_for(change.path),
    )
    original, modified = await _sides(repo, change, staged)
    if original is TOO_LARGE or modified is TOO_LARGE:
        diff.too_large = True
        return diff

    texts = [None if side is None else _decode(side) for side in (original, modified)]
    if any(side is not None and text is None for side, text in zip((original, modified), texts)):
        diff.binary = True
        return diff
    diff.original, diff.modified = texts
    return diff
