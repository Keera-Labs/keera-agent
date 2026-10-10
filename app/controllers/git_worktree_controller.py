from pathlib import Path

from app.models.Agent import Agent
from app.services.git_repository import GitRepository
from app.services.process import CommandError
from app.utils.agent_worktree import agent_id_for_worktree
from app.utils.git_responses import git_error_response
from app.utils.project_paths import project_root


async def index(project_id: int):
    repo = await GitRepository.discover(await project_root(project_id))
    if repo is None:
        return {"worktrees": []}
    try:
        worktrees = await repo.worktrees()
    except CommandError as e:
        return git_error_response(e)

    agent_ids = [
        i for i in map(agent_id_for_worktree, (w.path for w in worktrees)) if i is not None
    ]
    agents = (
        await Agent.where("project_id", project_id)
        .where_in("id", agent_ids)
        .where_null("deleted_at")
        .get()
        if agent_ids
        else []
    )
    names = {agent.id: agent.name for agent in agents}

    rows = []
    for position, worktree in enumerate(worktrees):
        # A bare main repo has no working tree to show; it still counts as "main".
        if worktree.bare:
            continue
        agent_id = agent_id_for_worktree(worktree.path)
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
