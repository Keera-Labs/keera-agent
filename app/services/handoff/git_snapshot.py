import os
import subprocess
import tempfile
from dataclasses import dataclass, field

from app.services.handoff.errors import HandoffConflict, HandoffInvalid, HandoffTargetFailed

SECRET_PATHSPECS = (
    ":(exclude,glob)**/.env",
    ":(exclude,glob)**/.env.*",
    ":(exclude,glob)**/*.pem",
    ":(exclude,glob)**/*.key",
    ":(exclude,glob)**/id_rsa*",
    ":(exclude,glob)**/id_ed25519*",
    ":(exclude,glob)**/.claude/settings.local.json",
)
_GIT_ENV = {"GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C"}
_IDENTITY = {
    "GIT_AUTHOR_NAME": "Keera Handoff",
    "GIT_AUTHOR_EMAIL": "handoff@keera.local",
    "GIT_COMMITTER_NAME": "Keera Handoff",
    "GIT_COMMITTER_EMAIL": "handoff@keera.local",
}


@dataclass
class Snapshot:
    branch: str
    source_branch: str | None
    base_sha: str
    head_sha: str
    wip: bool
    excluded: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "branch": self.branch,
            "source_branch": self.source_branch,
            "base_sha": self.base_sha,
            "head_sha": self.head_sha,
            "wip": self.wip,
        }


def git(cwd: str, *args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        env={**os.environ, **_GIT_ENV, **(env or {})},
        timeout=300,
    )


def _out(cwd: str, *args: str, env: dict | None = None) -> str:
    result = git(cwd, *args, env=env)
    if result.returncode != 0:
        raise HandoffInvalid(f"git {args[0]} failed in the agent worktree.")
    return result.stdout.strip()


def remote_url(cwd: str) -> str:
    result = git(cwd, "remote", "get-url", "origin")
    if result.returncode != 0 or not result.stdout.strip():
        raise HandoffInvalid("The project has no 'origin' remote to share the handoff branch.")
    return result.stdout.strip()


def normalize_remote(url: str) -> str:
    value = url.strip().removesuffix("/").removesuffix(".git").lower()
    scheme, separator, rest = value.partition("://")
    if separator:
        value = rest.split("@", 1)[-1]
        return value if scheme == "file" else value.replace(":", "/", 1)
    if "@" in value and ":" in value and not value.startswith("/"):
        return value.split("@", 1)[-1].replace(":", "/", 1)
    return value


def take_snapshot(worktree: str, branch: str) -> Snapshot:
    base_sha = _out(worktree, "rev-parse", "HEAD")
    head = git(worktree, "symbolic-ref", "-q", "--short", "HEAD")
    source_branch = head.stdout.strip() or None
    excluded = _excluded_secrets(worktree)
    with tempfile.TemporaryDirectory() as scratch:
        index = {"GIT_INDEX_FILE": os.path.join(scratch, "index")}
        _out(worktree, "read-tree", "HEAD", env=index)
        _out(worktree, "add", "-A", "--", ".", *SECRET_PATHSPECS, env=index)
        tree = _out(worktree, "write-tree", env=index)
    head_tree = _out(worktree, "rev-parse", "HEAD^{tree}")
    if tree == head_tree:
        return Snapshot(branch, source_branch, base_sha, base_sha, False, excluded)
    message = f"wip: handoff snapshot of {source_branch or base_sha[:12]}"
    head_sha = _out(worktree, "commit-tree", tree, "-p", base_sha, "-m", message, env=_IDENTITY)
    return Snapshot(branch, source_branch, base_sha, head_sha, True, excluded)


def _excluded_secrets(worktree: str) -> list[str]:
    listed = git(worktree, "ls-files", "--others", "--modified", "--exclude-standard", "-z")
    paths = [path for path in listed.stdout.split("\0") if path]
    kept = git(
        worktree,
        "ls-files",
        "--others",
        "--modified",
        "--exclude-standard",
        "-z",
        "--",
        ".",
        *SECRET_PATHSPECS,
    )
    kept_paths = {path for path in kept.stdout.split("\0") if path}
    return sorted(path for path in paths if path not in kept_paths)


def push_snapshot(worktree: str, snapshot: Snapshot) -> None:
    result = git(worktree, "push", "origin", f"{snapshot.head_sha}:refs/heads/{snapshot.branch}")
    if result.returncode != 0:
        raise HandoffTargetFailed("Could not push the handoff branch to the shared remote.")


def checkout_snapshot(project_path: str, worktree: str, local_branch: str, git_info: dict) -> None:
    if (
        git(project_path, "rev-parse", "--verify", "-q", f"refs/heads/{local_branch}").returncode
        == 0
    ):
        raise HandoffConflict(f"Branch {local_branch} already exists on this server.")
    if os.path.exists(worktree):
        raise HandoffConflict("The agent worktree path already exists on this server.")
    branch = git_info["branch"]
    fetched = git(
        project_path, "fetch", "origin", f"+refs/heads/{branch}:refs/remotes/origin/{branch}"
    )
    if fetched.returncode != 0:
        raise HandoffInvalid(f"Could not fetch {branch} from the shared remote.")
    if _out(project_path, "rev-parse", f"refs/remotes/origin/{branch}") != git_info["head_sha"]:
        raise HandoffConflict(f"{branch} on the remote does not match the handed-off commit.")
    added = git(project_path, "worktree", "add", "-b", local_branch, worktree, git_info["head_sha"])
    if added.returncode != 0:
        raise HandoffInvalid("Could not create the agent worktree.")
    if git_info.get("wip"):
        _out(worktree, "reset", "-q", "--mixed", git_info["base_sha"])


def remove_checkout(project_path: str, worktree: str, local_branch: str) -> None:
    git(project_path, "worktree", "remove", "--force", worktree)
    git(project_path, "branch", "-D", local_branch)
