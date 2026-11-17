import subprocess

from fastapi_startkit.logging import Log


def _git_succeeds(path: str, *args: str) -> bool:
    try:
        result = subprocess.run(["git", *args], cwd=path, capture_output=True, text=True)
    except OSError:
        return False
    return result.returncode == 0 and result.stdout.strip() != "false"


def repo_has_commit(path: str) -> bool:
    return _git_succeeds(path, "rev-parse", "--is-inside-work-tree") and _git_succeeds(
        path, "rev-parse", "--verify", "--quiet", "HEAD^{commit}"
    )


def agent_worktree_available(agent, cwd: str) -> bool:
    if not getattr(agent, "use_worktree", True):
        return False
    if repo_has_commit(cwd):
        return True
    Log.warning(
        f"Agent {agent.id} runs in {cwd} without a worktree: "
        "the project needs a git repository with at least one commit"
    )
    return False
