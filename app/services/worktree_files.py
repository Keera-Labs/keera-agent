import os
import shutil
from pathlib import Path

from fastapi_startkit.logging import Logger

_NEVER_COPIED = (Path(".git"), Path(".claude/worktrees"))


def _is_never_copied(relative: Path) -> bool:
    return not relative.parts or any(relative.is_relative_to(path) for path in _NEVER_COPIED)


def _copy_if_absent(source: str, target: str) -> None:
    if not os.path.lexists(target):
        shutil.copy2(source, target, follow_symlinks=False)


def _copy(root: Path, source: Path, target: Path) -> None:
    def ignore_never_copied(directory: str, names: list[str]) -> set[str]:
        relative = Path(directory).relative_to(root)
        return {name for name in names if _is_never_copied(relative / name)}

    target.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir() and not source.is_symlink():
        shutil.copytree(
            source,
            target,
            symlinks=True,
            ignore=ignore_never_copied,
            copy_function=_copy_if_absent,
            dirs_exist_ok=True,
        )
    else:
        _copy_if_absent(str(source), str(target))


def copy_worktree_files(
    project_root: str | Path, worktree: str | Path, patterns: list[str]
) -> None:
    root = Path(project_root)
    destination = Path(worktree)
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
            try:
                _copy(root, source, destination / relative)
            except OSError as exc:
                Logger.warning(f"Could not copy '{relative}' into worktree {destination}: {exc}")
