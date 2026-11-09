import os
from pathlib import Path

from app.exceptions.task_rule_rejected_error import TaskRuleRejectedError
from app.models.Project import Project
from app.models.Task import Task
from app.services.git_repository import GitRepository
from app.services.github_cli import GitHubCli
from app.services.process import CommandError


async def merged_pull_request_head(task: Task) -> str:
    ref = task.pr_url or (str(task.pr_number) if task.pr_number else None)
    if not ref:
        raise TaskRuleRejectedError(f"task #{task.id} has no pr_number or pr_url; pass merged_sha")
    project = await Project.find(task.project_id)
    repo = await GitRepository.discover(Path(os.path.expanduser(project.path))) if project else None
    if repo is None:
        raise TaskRuleRejectedError(f"task #{task.id} has no git repository; pass merged_sha")
    try:
        pull_request = await GitHubCli(repo).pull_request_head(ref)
    except CommandError as exc:
        raise TaskRuleRejectedError(
            f"could not read PR {ref} from GitHub; pass merged_sha"
        ) from exc
    if pull_request["state"] != "MERGED":
        raise TaskRuleRejectedError(f"PR {ref} is {pull_request['state']}, not merged")
    return pull_request["head_sha"]
