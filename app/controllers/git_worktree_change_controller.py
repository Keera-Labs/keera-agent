from app.services.git_repository import GitRepository
from app.services.process import CommandError
from app.utils.git_responses import git_error_response
from app.utils.project_paths import project_root


async def index(project_id: int):
    repo = await GitRepository.discover(await project_root(project_id))
    if repo is None:
        return {"changes": {}}
    try:
        counts = await repo.worktree_change_counts()
    except CommandError as e:
        return git_error_response(e)
    return {"changes": counts}
