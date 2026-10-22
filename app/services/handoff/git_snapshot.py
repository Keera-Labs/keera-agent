import fnmatch
import os
import subprocess
import tempfile
from dataclasses import dataclass

from app.services.handoff.errors import (
    HandoffConflict,
    HandoffInvalid,
    HandoffSecretsFound,
    HandoffTargetFailed,
)

SECRET_NAME_PATTERNS = (
    ".env",
    ".env.*",
    "*.env",
    ".envrc",
    "id_rsa*",
    "id_dsa*",
    "id_ecdsa*",
    "id_ed25519*",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "*.jks",
    "*.keystore",
    "*.kdbx",
    ".npmrc",
    ".pypirc",
    ".netrc",
    "_netrc",
    ".git-credentials",
    ".pgpass",
    "credentials",
    "credentials.json",
    "*-key.json",
    "*_key.json",
    "service-account*.json",
    "*.tfvars",
    "*.tfvars.json",
    "*.tfstate",
    "*.tfstate.backup",
    "secrets.*",
    "settings.local.json",
)
SECRET_PATH_PATTERNS = (".aws/*", ".ssh/*", ".docker/config.json", ".kube/config", ".gnupg/*")
SAFE_NAME_PATTERNS = (".env.example", ".env.sample", ".env.template", ".env.dist", "*.pub")
_GIT_ENV = {"GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C"}
_IDENTITY = {
    "GIT_AUTHOR_NAME": "Keera Handoff",
    "GIT_AUTHOR_EMAIL": "handoff@keera.local",
    "GIT_COMMITTER_NAME": "Keera Handoff",
    "GIT_COMMITTER_EMAIL": "handoff@keera.local",
}
GIT_TIMEOUT = 300


@dataclass
class Snapshot:
    branch: str
    source_branch: str | None
    base_sha: str
    head_sha: str
    wip: bool

    def to_dict(self) -> dict:
        return {
            "branch": self.branch,
            "source_branch": self.source_branch,
            "base_sha": self.base_sha,
            "head_sha": self.head_sha,
            "wip": self.wip,
        }


def git(cwd: str, *args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            env={**os.environ, **_GIT_ENV, **(env or {})},
            timeout=GIT_TIMEOUT,
        )
    except subprocess.TimeoutExpired as exc:
        raise HandoffTargetFailed(f"git {args[0]} timed out.") from exc


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


def looks_secret(path: str) -> bool:
    lowered = path.lower()
    name = os.path.basename(lowered)
    if any(fnmatch.fnmatchcase(name, pattern) for pattern in SAFE_NAME_PATTERNS):
        return False
    if any(fnmatch.fnmatchcase(name, pattern) for pattern in SECRET_NAME_PATTERNS):
        return True
    return any(
        fnmatch.fnmatchcase(lowered, pattern) or fnmatch.fnmatchcase(lowered, f"*/{pattern}")
        for pattern in SECRET_PATH_PATTERNS
    )


def take_snapshot(worktree: str, branch: str) -> Snapshot:
    base_sha = _out(worktree, "rev-parse", "HEAD")
    head = git(worktree, "symbolic-ref", "-q", "--short", "HEAD")
    source_branch = head.stdout.strip() or None
    tree = _worktree_tree(worktree)
    refuse_secrets(worktree, tree)
    if tree == _out(worktree, "rev-parse", "HEAD^{tree}"):
        return Snapshot(branch, source_branch, base_sha, base_sha, False)
    message = f"wip: handoff snapshot of {source_branch or base_sha[:12]}"
    head_sha = _out(worktree, "commit-tree", tree, "-p", base_sha, "-m", message, env=_IDENTITY)
    return Snapshot(branch, source_branch, base_sha, head_sha, True)


def check_secrets(worktree: str) -> None:
    refuse_secrets(worktree, _worktree_tree(worktree))


def refuse_secrets(worktree: str, tree: str) -> None:
    changed = _out(
        worktree, "diff", "--name-only", "-z", "--no-renames", "--diff-filter=ACMT", "HEAD", tree
    )
    secrets = sorted(path for path in changed.split("\0") if path and looks_secret(path))
    if secrets:
        raise HandoffSecretsFound(secrets)


def _worktree_tree(worktree: str) -> str:
    with tempfile.TemporaryDirectory() as scratch:
        index = {"GIT_INDEX_FILE": os.path.join(scratch, "index")}
        _out(worktree, "read-tree", "HEAD", env=index)
        _out(worktree, "add", "-A", "--", ".", env=index)
        return _out(worktree, "write-tree", env=index)


def push_snapshot(worktree: str, snapshot: Snapshot) -> None:
    result = git(worktree, "push", "origin", f"{snapshot.head_sha}:refs/heads/{snapshot.branch}")
    if result.returncode != 0:
        raise HandoffTargetFailed("Could not push the handoff branch to the shared remote.")


def delete_remote_branch(worktree: str, branch: str) -> bool:
    try:
        return git(worktree, "push", "origin", "--delete", branch).returncode == 0
    except HandoffTargetFailed:
        return False


def checkout_slot_taken(project_path: str, worktree: str, local_branch: str) -> bool:
    branch = git(project_path, "rev-parse", "--verify", "-q", f"refs/heads/{local_branch}")
    return branch.returncode == 0 or os.path.lexists(worktree)


def checkout_snapshot(project_path: str, worktree: str, local_branch: str, git_info: dict) -> None:
    if checkout_slot_taken(project_path, worktree, local_branch):
        raise HandoffConflict(f"{local_branch} or its worktree already exists on this server.")
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
        try:
            _out(worktree, "reset", "-q", "--mixed", git_info["base_sha"])
        except Exception:
            remove_checkout(project_path, worktree, local_branch)
            raise


def remove_checkout(project_path: str, worktree: str, local_branch: str) -> None:
    git(project_path, "worktree", "remove", "--force", worktree)
    git(project_path, "branch", "-D", local_branch)
