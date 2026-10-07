import re
from pathlib import Path

from app.models.Agent import Agent
from app.services.git_repository import GitRepository
from app.services.process import CommandError
from app.utils.git_responses import git_error_response
from app.utils.project_paths import project_root

# `claude --worktree agent-<id>` checks an agent out at <repo>/.claude/worktrees/agent-<id>.
_AGENT_WORKTREE = re.compile(r"/\.claude/worktrees/agent-(\d+)$")


def _agent_id(path: str) -> int | None:
    match = _AGENT_WORKTREE.search(path)
    return int(match.group(1)) if match else None


async def index(project_id: int):
    repo = await GitRepository.discover(await project_root(project_id))
    if repo is None:
        return {"worktrees": []}
    try:
        worktrees = await repo.worktrees()
    except CommandError as e:
        return git_error_response(e)

    agent_ids = [i for i in map(_agent_id, (w.path for w in worktrees)) if i is not None]
    agents = await Agent.where_in("id", agent_ids).get() if agent_ids else []
    names = {agent.id: agent.name for agent in agents}

    rows = []
    for position, worktree in enumerate(worktrees):
        # A bare main repo has no working tree to show; it still counts as "main".
        if worktree.bare:
            continue
        agent_id = _agent_id(worktree.path)
        rows.append(
            {
                "path": worktree.path,
                "branch": worktree.branch,
                "head": worktree.head,
                "detached": worktree.detached,
                "is_main": position == 0,
                "is_current": Path(worktree.path) == repo.root,
                "locked": worktree.locked,
                "prunable": worktree.prunable,
                "agent_id": agent_id,
                "agent_name": names.get(agent_id),
            }
        )
    return {"worktrees": rows}
