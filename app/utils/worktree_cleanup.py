"""Utility for cleaning up git worktrees created for agent sessions."""
import os
import shutil
import subprocess


def cleanup_agent_worktree(project_path: str, agent_id: int) -> None:
    """Remove the git worktree for an agent, if it exists.

    Worktrees live at ``<project_path>/.worktrees/agent-<agent_id>``.
    First attempts ``git worktree remove --force`` to keep git state clean;
    falls back to ``shutil.rmtree`` if the git command fails or git is
    unavailable, so the directory is always cleaned up regardless.
    """
    expanded = os.path.expanduser(project_path)
    worktree_path = os.path.join(expanded, ".worktrees", f"agent-{agent_id}")

    if not os.path.exists(worktree_path):
        return

    # Try the git-aware removal first.
    try:
        result = subprocess.run(
            ["git", "worktree", "remove", "--force", worktree_path],
            cwd=expanded,
            capture_output=True,
            timeout=15,
        )
        if result.returncode == 0:
            return
    except Exception:
        pass

    # Fallback: plain directory removal.
    try:
        shutil.rmtree(worktree_path, ignore_errors=True)
    except Exception:
        pass
