"""Safe removal of git worktrees left behind by agents.

A worktree is only removed when nothing in it can be lost: no uncommitted or
untracked files, and every commit on its HEAD is reachable from a remote ref or
another local branch. `git worktree remove` is never forced, and a lock is only
lifted once the process that took it is gone.
"""

import os
import re
import subprocess
import time
from dataclasses import asdict, dataclass, field

from fastapi_startkit.logging import Logger

# Never deleted even when fully pushed: other worktrees and the user work off them.
PROTECTED_BRANCHES = {"main", "master", "dev", "develop"}
AGENT_WORKTREE_DIRS = (os.path.join(".claude", "worktrees"), ".worktrees")
# Claude writes "claude session agent-N (pid 123 start ...)" as the lock reason.
_LOCK_PID = re.compile(r"\(pid (\d+)")
_AGENT_PATH = re.compile(r"/\.claude/worktrees/agent-(\d+)$")
_GIT_ENV = {"GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C"}


@dataclass
class Worktree:
    path: str
    branch: str | None = None
    lock_reason: str | None = None
    locked: bool = False
    prunable: bool = False

    @property
    def agent_id(self) -> int | None:
        match = _AGENT_PATH.search(self.path)
        return int(match.group(1)) if match else None


@dataclass
class Assessment:
    worktree: Worktree
    dirty: int = 0
    unpushed: int = 0
    reasons: list[str] = field(default_factory=list)

    @property
    def removable(self) -> bool:
        return not self.reasons


@dataclass
class RemovalResult:
    path: str
    branch: str | None = None
    removed: bool = False
    branch_deleted: bool = False
    error: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def git(cwd: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        env={**os.environ, **_GIT_ENV},
        timeout=60,
    )


def list_worktrees(repo: str) -> list[Worktree]:
    """Every linked worktree of the repo at `repo` (the main checkout excluded)."""
    result = git(repo, "worktree", "list", "--porcelain")
    if result.returncode != 0:
        return []
    worktrees: list[Worktree] = []
    for block in result.stdout.strip().split("\n\n")[1:]:
        wt = Worktree(path="")
        for line in block.splitlines():
            key, _, value = line.partition(" ")
            if key == "worktree":
                wt.path = value
            elif key == "branch":
                wt.branch = value.removeprefix("refs/heads/")
            elif key == "locked":
                wt.locked, wt.lock_reason = True, value or None
            elif key == "prunable":
                wt.prunable = True
        if wt.path:
            worktrees.append(wt)
    return worktrees


def lock_pid(wt: Worktree) -> int | None:
    match = _LOCK_PID.search(wt.lock_reason or "")
    return int(match.group(1)) if match else None


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def wait_for_lock_holder(wt: Worktree, timeout: float) -> None:
    """Give the process holding the worktree lock up to `timeout` seconds to exit."""
    pid = lock_pid(wt)
    deadline = time.monotonic() + timeout
    while pid and pid_alive(pid) and time.monotonic() < deadline:
        time.sleep(0.1)


def unique_commits(repo: str, rev: str, branch: str | None) -> int | None:
    """Commits on `rev` reachable from no remote ref and no other local branch."""
    args = ["rev-list", "--count", rev, "--not"]
    if branch:
        # --exclude before --branches takes the name without refs/heads/.
        args.append(f"--exclude={branch}")
    result = git(repo, *args, "--branches", "--remotes")
    return int(result.stdout) if result.returncode == 0 else None


def assess(wt: Worktree) -> Assessment:
    assessment = Assessment(worktree=wt)
    reasons = assessment.reasons
    if not os.path.isdir(wt.path):
        reasons.append("directory missing")
        return assessment
    if wt.locked:
        pid = lock_pid(wt)
        if pid is None:
            reasons.append(f"locked: {wt.lock_reason or 'no reason given'}")
        elif pid_alive(pid):
            reasons.append(f"locked by running pid {pid}")
    status = git(wt.path, "status", "--porcelain")
    commits = unique_commits(wt.path, "HEAD", wt.branch)
    if status.returncode != 0 or commits is None:
        reasons.append("git could not read the worktree")
        return assessment
    assessment.dirty = len(status.stdout.splitlines())
    assessment.unpushed = commits
    if assessment.dirty:
        reasons.append(f"{assessment.dirty} uncommitted/untracked files")
    if assessment.unpushed:
        reasons.append(f"{assessment.unpushed} unpushed commits")
    return assessment


def remove(repo: str, wt: Worktree) -> RemovalResult:
    """Remove the worktree (and its branch) if assess() still finds it safe to."""
    result = RemovalResult(path=wt.path, branch=wt.branch)
    assessment = assess(wt)
    if not assessment.removable:
        result.error = "skipped: " + "; ".join(assessment.reasons)
        return result

    if wt.locked:
        # assess() only passes a lock whose holder has exited.
        git(repo, "worktree", "unlock", wt.path)
    removed = git(repo, "worktree", "remove", wt.path)
    if removed.returncode != 0:
        result.error = removed.stderr.strip() or "git worktree remove failed"
        return result
    result.removed = True

    if wt.branch and wt.branch not in PROTECTED_BRANCHES:
        # Every commit on the branch is on a remote or another branch, so -D loses nothing.
        deleted = git(repo, "branch", "-D", wt.branch)
        result.branch_deleted = deleted.returncode == 0
        if not result.branch_deleted:
            result.error = deleted.stderr.strip() or f"could not delete branch {wt.branch}"
    return result


def _delete_branch_if_safe(repo: str, branch: str) -> RemovalResult | None:
    """Delete a branch no worktree has checked out, if no commit would be lost."""
    if git(repo, "rev-parse", "--verify", "-q", f"refs/heads/{branch}").returncode != 0:
        return None
    listing = git(repo, "worktree", "list", "--porcelain").stdout
    if f"branch refs/heads/{branch}\n" in listing + "\n":
        return None
    result = RemovalResult(path="", branch=branch)
    commits = unique_commits(repo, f"refs/heads/{branch}", branch)
    if commits != 0:
        result.error = f"skipped: branch {branch} has {commits} unpushed commits"
        return result
    deleted = git(repo, "branch", "-D", branch)
    result.branch_deleted = deleted.returncode == 0
    if not result.branch_deleted:
        result.error = deleted.stderr.strip()
    return result


def cleanup_agent_worktree(repo: str, agent_id: int, wait: float = 5.0) -> list[dict]:
    """Safely remove an agent's worktree(s) and its default branch; never raises.

    `wait` bounds how long to let the agent's CLI exit and release its lock
    normally before a lock whose holder is still alive makes us skip.
    """
    name = f"agent-{agent_id}"
    targets = {os.path.realpath(os.path.join(repo, d, name)) for d in AGENT_WORKTREE_DIRS}
    results: list[RemovalResult] = []
    try:
        for wt in list_worktrees(repo):
            if os.path.realpath(wt.path) not in targets:
                continue
            if wt.locked and wait > 0:
                wait_for_lock_holder(wt, wait)
                wt = next((w for w in list_worktrees(repo) if w.path == wt.path), wt)
            results.append(remove(repo, wt))
        stray = _delete_branch_if_safe(repo, f"worktree-{name}")
        if stray:
            results.append(stray)
    except Exception as e:
        results.append(RemovalResult(path=repo, error=f"cleanup failed: {e}"))

    for r in results:
        if r.error:
            Logger.warning(f"Agent {agent_id} worktree cleanup: {r.path or r.branch}: {r.error}")
        elif r.removed:
            Logger.info(f"Agent {agent_id} worktree removed: {r.path} (branch {r.branch})")
    return [r.to_dict() for r in results]


@dataclass
class PruneCandidate:
    assessment: Assessment
    owner: str = "-"
    size_kb: int = 0

    @property
    def worktree(self) -> Worktree:
        return self.assessment.worktree


@dataclass
class PrunePlan:
    repo: str
    candidates: list[PruneCandidate] = field(default_factory=list)
    missing: list[Worktree] = field(default_factory=list)
    external: int = 0


def disk_kb(path: str) -> int:
    result = subprocess.run(["du", "-sk", path], capture_output=True, text=True)
    try:
        return int(result.stdout.split()[0])
    except (IndexError, ValueError):
        return 0


def last_activity(path: str) -> float:
    """Newest mtime of the worktree's HEAD/index, i.e. when it was last checked out or staged."""
    gitdir = git(path, "rev-parse", "--absolute-git-dir")
    base = gitdir.stdout.strip() if gitdir.returncode == 0 else path
    times = [
        os.path.getmtime(p)
        for p in (os.path.join(base, f) for f in ("HEAD", "index", "logs/HEAD"))
        if os.path.exists(p)
    ]
    return max(times, default=os.path.getmtime(path))


def claude_project_dir(worktree_path: str) -> str:
    """Where the Claude CLI keeps session transcripts for a working directory."""
    encoded = re.sub(r"[^A-Za-z0-9-]", "-", worktree_path)
    return os.path.join(os.path.expanduser("~"), ".claude", "projects", encoded)


def _in_agent_dirs(repo: str, path: str) -> bool:
    real = os.path.realpath(path)
    return any(
        real.startswith(os.path.realpath(os.path.join(repo, d)) + os.sep)
        for d in AGENT_WORKTREE_DIRS
    )


def plan_prune(
    repo: str,
    live_agent_ids: set[int],
    include_external: bool = False,
    min_age_hours: float = 24.0,
) -> PrunePlan:
    """Read-only: classify every orphaned worktree of `repo` as removable or skipped."""
    plan = PrunePlan(repo=repo)
    cutoff = time.time() - min_age_hours * 3600
    for wt in list_worktrees(repo):
        if not os.path.isdir(wt.path):
            plan.missing.append(wt)
            continue
        if not include_external and not _in_agent_dirs(repo, wt.path):
            plan.external += 1
            continue

        assessment = assess(wt)
        candidate = PruneCandidate(assessment=assessment, size_kb=disk_kb(wt.path))
        agent_id = wt.agent_id
        if agent_id is not None:
            live = agent_id in live_agent_ids
            candidate.owner = f"{'live' if live else 'gone'} agent {agent_id}"
            if live:
                assessment.reasons.insert(0, "owned by a live agent")
        if agent_id is None and min_age_hours > 0 and last_activity(wt.path) > cutoff:
            # A task worktree an agent made for itself names no owner, so a live agent may
            # still be using it; recent activity is the only tell.
            assessment.reasons.append(f"used within the last {min_age_hours:g}h")
        plan.candidates.append(candidate)
    return plan


def prune_missing(repo: str) -> list[str]:
    """Drop git's bookkeeping for worktrees whose directory is gone (locked ones are kept)."""
    result = git(repo, "worktree", "prune", "--verbose")
    return [line for line in (result.stdout + result.stderr).splitlines() if line.strip()]
