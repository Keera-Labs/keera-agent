import datetime

from fastapi.responses import JSONResponse
from fastapi_startkit.jsonapi import ResourceCollection

from app.models.Task import Task, TERMINAL_STATUSES
from app.requests.task_request import TaskStoreRequest, TaskUpdateRequest
from app.resources.task_resource import TaskResource


async def index(project_id: int) -> ResourceCollection:
    cutoff = (datetime.datetime.now() - datetime.timedelta(days=7)).isoformat()

    # Active tasks (not completed or cancelled)
    active = await Task.where("project_id", project_id)\
        .where_not_in("status", TERMINAL_STATUSES).get()

    # Recently completed/cancelled tasks (within last 7 days)
    recent = await Task.where("project_id", project_id)\
        .where_in("status", TERMINAL_STATUSES)\
        .where("completed_at", ">=", cutoff).get()

    all_tasks = list(active) + list(recent)
    all_tasks.sort(key=lambda t: t.id)

    return TaskResource.collection(all_tasks)


async def store(body: TaskStoreRequest, project_id: int) -> TaskResource:
    task = await Task.create({
        **body.model_dump(),
        "project_id": project_id,
        "status": "pending",
    })

    return TaskResource(task)


async def update(request: TaskUpdateRequest, task_id: int):
    task = await Task.find(task_id)
    if not task:
        return JSONResponse({"error": "not found"}, status_code=404)

    completed_at = (
        datetime.datetime.now().isoformat()
        if request.status in TERMINAL_STATUSES
        else None
    )

    await task.update({
        **request.model_dump(exclude_unset=True),
        "completed_at": completed_at,
    })
    return TaskResource(task)


async def destroy(task_id: int):
    task = await Task.find(task_id)
    if not task:
        return JSONResponse({"error": "not found"}, status_code=404)

    await Task.where("id", task_id).delete()
    return JSONResponse({}, status_code=204)
