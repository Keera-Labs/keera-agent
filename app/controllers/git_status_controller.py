from app.services.git_repository import GitRepository, RepositoryStatus
from app.services.process import CommandError
from app.utils.git_responses import git_error_response
from app.utils.project_paths import project_root


async def show(project_id: int):
    # A project that isn't a git repo is a normal state for the panel, not an error.
    repo = await GitRepository.discover(await project_root(project_id))
    if repo is None:
        return RepositoryStatus().to_dict()
    try:
        return (await repo.status()).to_dict()
    except CommandError as e:
        return git_error_response(e)
