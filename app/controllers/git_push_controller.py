from app.services.git_repository import GitRepository
from app.services.process import CommandError
from app.utils.git_responses import git_error_response


async def store(project_id: int):
    try:
        repo = await GitRepository.for_project(project_id)
        pushed = await repo.push()
        return {**pushed, "status": (await repo.status()).to_dict()}
    except CommandError as e:
        return git_error_response(e)
