from fastapi.responses import JSONResponse

from app.models.Project import Project
from app.requests.project_task_rules_request import ProjectTaskRulesUpdateRequest
from app.services.relay_identity import every_live_agent_carries_token


async def _task_rules_payload(project: Project) -> JSONResponse:
    return JSONResponse(
        {
            "data": {
                "task_rules": project.task_rules or "warn",
                "ownership_enforceable": await every_live_agent_carries_token(project.id),
            }
        }
    )


async def show(project_id: int) -> JSONResponse:
    return await _task_rules_payload(await Project.find_or_fail(project_id))


async def update(request: ProjectTaskRulesUpdateRequest, project_id: int) -> JSONResponse:
    project = await Project.find_or_fail(project_id)

    await project.update({"task_rules": request.task_rules})

    return await _task_rules_payload(project)
