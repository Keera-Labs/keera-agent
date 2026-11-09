import asyncio
import datetime
import os
from dataclasses import dataclass
from pathlib import Path

from app.services.git_repository import GitRepository
from app.services.process import CommandError
from app.services.worktree_cleanup import list_worktrees


@dataclass
class WorktreeSnapshot:
    path: str
    branch: str | None
    head_sha: str | None
    last_commit_at: datetime.datetime | None
    last_change_at: datetime.datetime | None


def _utc(timestamp: float) -> datetime.datetime:
    return datetime.datetime.fromtimestamp(timestamp, datetime.UTC)


def _newest_mtime(root: Path, paths: list[str]) -> float | None:
    mtimes = []
    for path in paths:
        try:
            mtimes.append((root / path).stat().st_mtime)
        except OSError:
            continue
    return max(mtimes, default=None)


async def probe_worktree(path: str) -> WorktreeSnapshot | None:
    root = Path(path)
    if not root.is_dir():
        return None
    repo = GitRepository(root)
    try:
        status = await repo.changed_files()
        log = await repo.git("log", "-1", "--format=%ct")
    except CommandError:
        return None
    last_commit_at = _utc(int(log.text.strip())) if log.ok and log.text.strip() else None
    changed = [c.path for c in status.staged + status.changes]
    newest = await asyncio.to_thread(_newest_mtime, root, changed)
    last_change_at = _utc(newest) if newest is not None else last_commit_at
    if last_commit_at and last_change_at and last_commit_at > last_change_at:
        last_change_at = last_commit_at
    return WorktreeSnapshot(
        path=str(root),
        branch=None if status.detached else status.branch,
        head_sha=status.head if status.has_commits else None,
        last_commit_at=last_commit_at,
        last_change_at=last_change_at,
    )


def agent_worktree_paths(project_path: str, agent_id: int, task_branch: str | None) -> list[str]:
    paths = [os.path.join(project_path, ".claude", "worktrees", f"agent-{agent_id}")]
    if task_branch:
        paths += [
            wt.path
            for wt in list_worktrees(project_path)
            if wt.branch == task_branch and wt.path not in paths
        ]
    return paths


async def probe_agent_worktrees(
    project_path: str, agent_id: int, task_branch: str | None
) -> WorktreeSnapshot | None:
    paths = await asyncio.to_thread(agent_worktree_paths, project_path, agent_id, task_branch)
    snapshots = [s for s in await asyncio.gather(*map(probe_worktree, paths)) if s]
    epoch = datetime.datetime.min.replace(tzinfo=datetime.UTC)
    return max(snapshots, key=lambda s: s.last_change_at or epoch, default=None)
