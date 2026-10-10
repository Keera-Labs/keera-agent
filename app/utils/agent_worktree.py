import re

_AGENT_WORKTREE = re.compile(r"/\.claude/worktrees/agent-(\d+)$")


def agent_id_for_worktree(path: str) -> int | None:
    match = _AGENT_WORKTREE.search(path)
    return int(match.group(1)) if match else None
