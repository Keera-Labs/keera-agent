from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Task import Task


async def index(request: Request, project_id: int):
    tasks = await Task.where("project_id", project_id).get()
    return JSONResponse([
        {
            "id": t.id,
            "project_id": t.project_id,
            "description": t.description,
            "status": t.status,
            "created_at": str(t.created_at),
        }
        for t in tasks
    ])


async def store(request: Request, project_id: int):
    body = await request.json()
    description = (body.get("description") or "").strip()
    if not description:
        return JSONResponse({"error": "description is required"}, status_code=422)

    task = await Task.create({
        "project_id": project_id,
        "description": description,
        "status": "pending",
    })
    return JSONResponse({
        "id": task.id,
        "project_id": task.project_id,
        "description": task.description,
        "status": task.status,
        "created_at": str(task.created_at),
    }, status_code=201)


async def update(request: Request, task_id: int):
    body = await request.json()
    task = await Task.find(task_id)
    if not task:
        return JSONResponse({"error": "not found"}, status_code=404)

    if "status" in body:
        task.status = body["status"]
    if "description" in body:
        desc = (body["description"] or "").strip()
        if desc:
            task.description = desc

    await task.save()
    return JSONResponse({
        "id": task.id,
        "project_id": task.project_id,
        "description": task.description,
        "status": task.status,
        "created_at": str(task.created_at),
    })


async def destroy(request: Request, task_id: int):
    task = await Task.find(task_id)
    if not task:
        return JSONResponse({"error": "not found"}, status_code=404)
    await task.delete()
    return JSONResponse({}, status_code=204)
