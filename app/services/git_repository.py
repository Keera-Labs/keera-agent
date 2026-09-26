"""Git operations on a project's repository, shaped for the Source Control panel."""

import asyncio
import posixpath
from dataclasses import asdict, dataclass, field
from pathlib import Path

from app.services.process import CommandError, CommandResult, run_command
from app.utils.project_paths import InvalidPath, project_root, resolve_project_path

READ_TIMEOUT = 30
# Commit/push run user hooks and network I/O; bounded so a hanging hook can't pin a request.
WRITE_TIMEOUT = 120
UNTRACKED_COUNT_LIMIT = 2 * 1024 * 1024

# Porcelain v2 status letters mapped onto the panel's vocabulary. "U" is shared by
# untracked (untracked=True) and unmerged entries (DD/AU/UD/UA/DU/AA/UU); "C" is a copy.
_STATUS_LETTERS = {"M": "M", "T": "M", "A": "A", "D": "D", "R": "R", "C": "C"}


class NotARepository(CommandError):
    def __init__(self):
        super().__init__("Not a git repository")


class InvalidRepoPath(CommandError):
    def __init__(self, path: str):
        super().__init__(f"Invalid path: {path}")


class InvalidWorktree(CommandError):
    def __init__(self, path: str):
        super().__init__(f"Unknown worktree: {path}")


class ChangeNotFound(CommandError):
    pass


@dataclass
class Worktree:
    path: str
    head: str | None = None
    branch: str | None = None
    detached: bool = False
    bare: bool = False
    locked: bool = False
    prunable: bool = False


def _parse_worktrees(raw: bytes) -> list[Worktree]:
    """Parse `worktree list --porcelain -z`: NUL-separated attributes, records end in NUL NUL."""
    worktrees: list[Worktree] = []
    for token in raw.decode("utf-8", "replace").split("\0"):
        key, _, value = token.partition(" ")
        if key == "worktree":
            worktrees.append(Worktree(str(Path(value).resolve())))
        elif not worktrees:
            continue
        elif key == "HEAD":
            worktrees[-1].head = None if set(value) == {"0"} else value
        elif key == "branch":
            worktrees[-1].branch = value.removeprefix("refs/heads/")
        elif key in ("detached", "bare", "locked", "prunable"):
            setattr(worktrees[-1], key, True)
    return worktrees


@dataclass
class FileChange:
    path: str
    status: str
    original_path: str | None = None
    additions: int | None = None
    deletions: int | None = None
    binary: bool = False
    untracked: bool = False

    @property
    def unmerged(self) -> bool:
        return self.status == "U" and not self.untracked

    def to_dict(self) -> dict:
        directory, name = posixpath.split(self.path)
        return {"name": name, "dir": directory, **asdict(self)}


@dataclass
class RepositoryStatus:
    is_repo: bool = False
    branch: str | None = None
    detached: bool = False
    head: str | None = None
    has_commits: bool = False
    upstream: str | None = None
    ahead: int = 0
    behind: int = 0
    staged: list[FileChange] = field(default_factory=list)
    changes: list[FileChange] = field(default_factory=list)

    def to_dict(self) -> dict:
        paths = {c.path for c in self.staged} | {c.path for c in self.changes}
        return {
            **{k: v for k, v in asdict(self).items() if k not in ("staged", "changes")},
            "staged": [c.to_dict() for c in self.staged],
            "changes": [c.to_dict() for c in self.changes],
            "count": len(paths),
        }


def _parse_status(raw: bytes) -> RepositoryStatus:
    status = RepositoryStatus(is_repo=True)
    tokens = raw.decode("utf-8", "replace").split("\0")
    i = 0
    while i < len(tokens):
        entry = tokens[i]
        i += 1
        if entry.startswith("# "):
            _parse_branch_header(status, entry[2:])
        elif entry.startswith(("1 ", "2 ")):
            parts = entry.split(" ", 9 if entry[0] == "2" else 8)
            xy, path = parts[1], parts[-1]
            original = None
            if entry[0] == "2":
                original = tokens[i]
                i += 1
            if xy[0] != ".":
                status.staged.append(
                    FileChange(path, _STATUS_LETTERS.get(xy[0], "M"), _renamed(xy[0], original))
                )
            if xy[1] != ".":
                status.changes.append(
                    FileChange(path, _STATUS_LETTERS.get(xy[1], "M"), _renamed(xy[1], original))
                )
        elif entry.startswith("u "):
            status.changes.append(FileChange(entry.split(" ", 10)[-1], "U"))
        elif entry.startswith("? "):
            status.changes.append(FileChange(entry[2:], "U", untracked=True))
    return status


def _renamed(letter: str, original: str | None) -> str | None:
    return original if letter in ("R", "C") else None


def _parse_branch_header(status: RepositoryStatus, header: str) -> None:
    key, _, value = header.partition(" ")
    if key == "branch.oid":
        status.has_commits = value != "(initial)"
        status.head = value if status.has_commits else None
    elif key == "branch.head":
        status.detached = value == "(detached)"
        status.branch = None if status.detached else value
    elif key == "branch.upstream":
        status.upstream = value
    elif key == "branch.ab":
        ahead, behind = value.split(" ")
        status.ahead, status.behind = int(ahead), abs(int(behind))


def _parse_numstat(raw: bytes) -> dict[str, tuple[int | None, int | None]]:
    """Map path -> (additions, deletions); None for binary files."""
    stats: dict[str, tuple[int | None, int | None]] = {}
    tokens = raw.decode("utf-8", "replace").split("\0")
    i = 0
    while i < len(tokens):
        entry = tokens[i]
        i += 1
        if not entry:
            continue
        added, deleted, path = entry.split("\t", 2)
        if not path:
            # Renames come as "added\tdeleted\t\0old\0new".
            path = tokens[i + 1]
            i += 2
        stats[path] = (
            None if added == "-" else int(added),
            None if deleted == "-" else int(deleted),
        )
    return stats


def _apply_numstat(changes: list[FileChange], stats: dict) -> None:
    for change in changes:
        if change.path in stats:
            change.additions, change.deletions = stats[change.path]
            change.binary = change.additions is None


def _count_untracked_lines(root: Path, changes: list[FileChange]) -> None:
    for change in changes:
        if not change.untracked:
            continue
        try:
            with open(root / change.path, "rb") as f:
                data = f.read(UNTRACKED_COUNT_LIMIT + 1)
        except OSError:
            continue
        if b"\0" in data[:8000]:
            change.binary = True
        elif len(data) <= UNTRACKED_COUNT_LIMIT:
            change.additions = data.count(b"\n") + (0 if not data or data.endswith(b"\n") else 1)
            change.deletions = 0


class GitRepository:
    def __init__(self, root: Path):
        self.root = root

    @classmethod
    async def discover(cls, path: Path) -> "GitRepository | None":
        try:
            result = await run_command(
                ["git", "rev-parse", "--show-toplevel"], cwd=path, timeout=READ_TIMEOUT
            )
        except CommandError:
            return None
        if not result.ok:
            return None
        return cls(Path(result.text.strip()).resolve())

    @classmethod
    async def for_project(cls, project_id: int, worktree: str | None = None) -> "GitRepository":
        repo = await cls.discover(await project_root(project_id))
        if repo is None:
            raise NotARepository()
        return await repo.select_worktree(worktree) if worktree else repo

    async def worktrees(self) -> list[Worktree]:
        result = await self.git_ok("worktree", "list", "--porcelain", "-z")
        return _parse_worktrees(result.stdout)

    async def select_worktree(self, path: str) -> "GitRepository":
        """Switch to one of this repo's worktrees; only paths git itself lists are accepted."""
        try:
            wanted = Path(path).resolve()
        except (OSError, ValueError, RuntimeError) as e:
            raise InvalidWorktree(path) from e
        for worktree in await self.worktrees():
            if Path(worktree.path) == wanted and not (worktree.bare or worktree.prunable):
                return GitRepository(wanted)
        raise InvalidWorktree(path)

    async def git(self, *args: str, timeout: float = READ_TIMEOUT, stdin: bytes | None = None):
        return await run_command(
            ["git", "--literal-pathspecs", *args], cwd=self.root, timeout=timeout, stdin=stdin
        )

    async def git_ok(self, *args: str, **kwargs) -> CommandResult:
        result = await self.git(*args, **kwargs)
        if not result.ok:
            raise CommandError(result.output or f"git {args[0]} failed", result.stderr)
        return result

    async def changed_files(self) -> RepositoryStatus:
        """Staged and unstaged changes without line counts: cheap enough for a single lookup."""
        porcelain = await self.git_ok(
            "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"
        )
        return _parse_status(porcelain.stdout)

    async def status(self) -> RepositoryStatus:
        status, unstaged, staged = await asyncio.gather(
            self.changed_files(),
            self.git_ok("diff", "--numstat", "-z", "-M"),
            self.git_ok("diff", "--cached", "--numstat", "-z", "-M"),
        )
        _apply_numstat(status.staged, _parse_numstat(staged.stdout))
        _apply_numstat(status.changes, _parse_numstat(unstaged.stdout))
        await asyncio.to_thread(_count_untracked_lines, self.root, status.changes)
        return status

    def pathspecs(self, paths: list[str]) -> list[str]:
        specs = []
        for raw in paths:
            try:
                rel, _ = resolve_project_path(self.root, raw)
            except InvalidPath as e:
                raise InvalidRepoPath(raw) from e
            specs.append(rel or ".")
        return specs

    async def stage(self, paths: list[str] | None) -> None:
        specs = self.pathspecs(paths) if paths is not None else []
        await self.git_ok("add", "--all", "--", *specs)

    async def unstage(self, paths: list[str] | None) -> None:
        specs = self.pathspecs(paths) if paths is not None else ["."]
        if await self.has_commits():
            await self.git_ok("reset", "-q", "--", *specs)
        else:
            await self.git_ok("rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", *specs)

    async def has_commits(self) -> bool:
        return (await self.git("rev-parse", "--verify", "--quiet", "HEAD")).ok

    async def has_staged_changes(self) -> bool:
        # `diff --cached --quiet` exits 1 when there are staged changes, and works on
        # an unborn branch (it compares against the empty tree).
        return (await self.git("diff", "--cached", "--quiet")).returncode == 1

    async def commit(self, message: str) -> dict:
        if not await self.has_staged_changes():
            raise CommandError("Nothing staged to commit")
        await self.git_ok("commit", "-q", "-F", "-", timeout=WRITE_TIMEOUT, stdin=message.encode())
        head = await self.git_ok("log", "-1", "--format=%H%x1f%h%x1f%s")
        sha, short_sha, subject = head.text.rstrip("\n").split("\x1f", 2)
        return {"sha": sha, "short_sha": short_sha, "subject": subject}

    async def push(self) -> dict:
        status = await self.status()
        if status.detached or not status.branch:
            raise CommandError("Cannot push a detached HEAD; check out a branch first")

        if status.upstream:
            result = await self.git_ok("push", timeout=WRITE_TIMEOUT)
        else:
            remote = await self.default_remote()
            result = await self.git_ok(
                "push", "-u", remote, f"HEAD:refs/heads/{status.branch}", timeout=WRITE_TIMEOUT
            )

        upstream = await self.git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
        return {
            "branch": status.branch,
            "upstream": upstream.text.strip() if upstream.ok else None,
            "output": result.output,
        }

    async def default_remote(self) -> str:
        remotes = (await self.git_ok("remote")).text.split()
        if not remotes:
            raise CommandError("No git remote configured")
        return "origin" if "origin" in remotes else remotes[0]

    async def has_ref(self, ref: str) -> bool:
        return (await self.git("rev-parse", "--verify", "--quiet", ref)).ok

    async def log(self, limit: int) -> list[dict]:
        if not await self.has_commits():
            return []
        result = await self.git_ok(
            "log", f"-n{limit}", "-z", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI"
        )
        commits = []
        for record in result.text.split("\0"):
            if record:
                sha, short_sha, subject, author, date = record.split("\x1f", 4)
                commits.append(
                    {
                        "sha": sha,
                        "short_sha": short_sha,
                        "subject": subject,
                        "author": author,
                        "date": date,
                    }
                )
        return commits
