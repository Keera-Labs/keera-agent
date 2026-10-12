import os
import shutil
from collections.abc import Iterator
from pathlib import Path

from fastapi_startkit.logging import Logger

_NEVER_COPIED = (Path(".git"), Path(".claude/worktrees"))


class PathEscapesError(OSError):
    pass


def _is_never_copied(relative: Path) -> bool:
    return not relative.parts or any(relative.is_relative_to(path) for path in _NEVER_COPIED)


def _resolves_inside(path: Path, root: Path) -> bool:
    return path.resolve().is_relative_to(root)


def _source_inside_project(root: Path, source: Path) -> bool:
    if not _resolves_inside(source.parent, root):
        return False
    return source.is_symlink() or _resolves_inside(source, root)


def _make_dir(destination: Path, target: Path) -> None:
    if not _resolves_inside(target, destination):
        raise PathEscapesError(f"'{target}' resolves outside the worktree")
    target.mkdir(parents=True, exist_ok=True)


def _copy_entry(destination: Path, source: Path, target: Path) -> None:
    if os.path.lexists(target):
        return
    _make_dir(destination, target.parent)
    shutil.copy2(source, target, follow_symlinks=False)


def _tree_entries(root: Path, directory: Path) -> Iterator[tuple[Path, bool]]:
    for dirpath, dirnames, filenames in os.walk(directory):
        here = Path(dirpath)
        kept = [name for name in dirnames if not _is_never_copied((here / name).relative_to(root))]
        dirnames[:] = [name for name in kept if not (here / name).is_symlink()]
        yield here, True
        for name in (*filenames, *(name for name in kept if (here / name).is_symlink())):
            yield here / name, False


def _copy(root: Path, destination: Path, source: Path) -> None:
    if source.is_symlink() or not source.is_dir():
        _copy_entry(destination, source, destination / source.relative_to(root))
        return
    for entry, is_dir in _tree_entries(root, source):
        target = destination / entry.relative_to(root)
        try:
            if is_dir:
                _make_dir(destination, target)
            else:
                _copy_entry(destination, entry, target)
        except OSError as exc:
            Logger.warning(f"Could not copy '{entry.relative_to(root)}' into worktree: {exc}")


def copy_worktree_files(
    project_root: str | Path, worktree: str | Path, patterns: list[str]
) -> None:
    root = Path(project_root).resolve()
    destination = Path(worktree).resolve()
    for pattern in patterns:
        try:
            matches = sorted(root.glob(pattern))
        except (ValueError, NotImplementedError):
            Logger.warning(f"Skipping invalid worktree copy pattern '{pattern}'")
            continue
        for source in matches:
            relative = source.relative_to(root)
            if _is_never_copied(relative):
                continue
            if not _source_inside_project(root, source):
                Logger.warning(f"Skipping '{relative}': it resolves outside the project")
                continue
            try:
                _copy(root, destination, source)
            except OSError as exc:
                Logger.warning(f"Could not copy '{relative}' into worktree {destination}: {exc}")
