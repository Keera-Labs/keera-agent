import os
from dataclasses import dataclass
from pathlib import Path

from app.actions.claude_hook_action import AGENT_ID_ENV
from app.models.Project import Project
from app.services.claude_config_dir import claude_env, project_config_dir
from app.services.git_repository import GitRepository, InvalidWorktree
from app.utils.agent_worktree import agent_id_for_worktree

PROJECT_ROOT_ENV = "KEERA_PROJECT_ROOT"
WORKTREE_ENV = "KEERA_WORKTREE"


async def command_env(project: Project) -> dict:
    return {**os.environ, **claude_env(await project_config_dir(project))}


@dataclass(frozen=True)
class CommandWorkspace:
    project: Project
    root: Path
    cwd: Path

    @classmethod
    async def resolve(cls, project: Project, worktree: str | None) -> "CommandWorkspace":
        root = Path(project.path).expanduser().resolve()
        if not worktree:
            return cls(project, root, root)
        if not Path(worktree).is_absolute():
            raise InvalidWorktree(worktree)
        repo = await GitRepository.discover(root)
        if repo is None:
            raise InvalidWorktree(worktree)
        return cls(project, root, (await repo.select_worktree(worktree)).root)

    @property
    def key(self) -> str:
        return str(self.cwd)

    async def env(self) -> dict:
        env = {
            **await command_env(self.project),
            PROJECT_ROOT_ENV: str(self.root),
            WORKTREE_ENV: str(self.cwd),
        }
        env.pop(AGENT_ID_ENV, None)
        agent_id = agent_id_for_worktree(str(self.cwd))
        if agent_id is not None:
            env[AGENT_ID_ENV] = str(agent_id)
        return env
