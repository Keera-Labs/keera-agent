from fastapi_startkit.application import app

from app.services.git_repository import GitRepository
from app.services.process import CommandError
from app.terminal.cli_supervisor import running_agent_ids
from app.terminal.manager import SHELL_SESSION_PREFIX
from app.utils.agent_worktree import agent_id_for_worktree


class WorktreeInUse(CommandError):
    def __init__(self):
        super().__init__("The worktree belongs to a running agent")


async def remove_worktree(project_id: int, path: str, force: bool = False) -> None:
    repo = await GitRepository.for_project(project_id)
    worktree = await repo.removable_worktree(path)
    if agent_id_for_worktree(worktree.path) in running_agent_ids():
        raise WorktreeInUse()
    await repo.remove_worktree(worktree, force=force)
    await app().make("terminal").close_within(worktree.path, prefix=SHELL_SESSION_PREFIX)
