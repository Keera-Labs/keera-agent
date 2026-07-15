import datetime

from fastapi.responses import Response
from fastapi_startkit.jsonapi import ResourceCollection

from app.models.Task import TERMINAL_STATUSES, Task
from app.requests.task_request import TaskStoreRequest, TaskUpdateRequest
from app.resources.task_resource import TaskResource


async def index(project_id: int) -> ResourceCollection:
    cutoff = (datetime.datetime.now() - datetime.timedelta(days=7)).isoformat()

    tasks = await (
        Task.where("project_id", project_id)
        .where(
            lambda q: (
                q.where_not_in("tasks.status", ["completed", "cancelled"])
                .or_where("tasks.completed_at", ">=", cutoff)
                .or_where_raw("tasks.completed_at IS NULL")
            )
        )
        .paginate()
    )

    return TaskResource.collection(tasks)


async def store(body: TaskStoreRequest, project_id: int) -> TaskResource:
    task = await Task.create(
        {
            **body.model_dump(),
            "project_id": project_id,
            "status": "pending",
        }
    )

    return TaskResource(task)


async def update(request: TaskUpdateRequest, task_id: int):
    task = await Task.find_or_fail(task_id)

    completed_at = (
        datetime.datetime.now().isoformat() if request.status in TERMINAL_STATUSES else None
    )

    await task.update(
        {
            **request.model_dump(exclude_unset=True),
            "completed_at": completed_at,
        }
    )
    return TaskResource(task)


async def destroy(task_id: int):
    await Task.find_or_fail(task_id)

    await Task.where("id", task_id).delete()
    # 204 must carry no body — a JSON body here triggers a server-side
    # "Response content longer than Content-Length" RuntimeError on every delete.
    return Response(status_code=204)
