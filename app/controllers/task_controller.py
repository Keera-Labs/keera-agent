import datetime
import json

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Task import Task

_TERMINAL_STATUSES = {"completed", "cancelled"}


def _load_json(value) -> list:
    if not value:
        return []
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return []


def _serialize(t: Task) -> dict:
    return {
        "id": t.id,
        "project_id": t.project_id,
        "title": t.title or t.description,
        "description": t.description,
        "body": t.body,
        "priority": t.priority or "medium",
        "assignees": _load_json(t.assignees),
        "acceptance_criteria": _load_json(t.acceptance_criteria),
        "testing_methods": _load_json(t.testing_methods),
        "validation_steps": _load_json(t.validation_steps),
        "status": t.status,
        "created_at": str(t.created_at),
        "completed_at": str(t.completed_at) if t.completed_at else None,
    }


async def index(request: Request, project_id: int):
    tasks = await Task.where("project_id", project_id).get()
    return JSONResponse([_serialize(t) for t in tasks])


async def store(request: Request, project_id: int):
    body = await request.json()
    title = (body.get("title") or "").strip()
    if not title:
        return JSONResponse({"error": "title is required"}, status_code=422)

    description = (body.get("description") or "").strip()
    task_body = (body.get("body") or "").strip()
    assignees = body.get("assignees") or []
    if not isinstance(assignees, list):
        assignees = []

    task = await Task.create({
        "project_id": project_id,
        "title": title,
        "description": description or title,
        "body": task_body or None,
        "assignees": json.dumps(assignees),
        "status": "pending",
    })
    return JSONResponse(_serialize(task), status_code=201)


async def update(request: Request, task_id: int):
    body = await request.json()
    task = await Task.find(task_id)
    if not task:
        return JSONResponse({"error": "not found"}, status_code=404)

    if "title" in body:
        title = (body["title"] or "").strip()
        if title:
            task.title = title
            task.description = title
    if "body" in body:
        task.body = (body["body"] or "").strip() or None
    if "assignees" in body:
        assignees = body["assignees"] if isinstance(body["assignees"], list) else []
        task.assignees = json.dumps(assignees)
    if "status" in body:
        new_status = body["status"]
        task.status = new_status
        if new_status in _TERMINAL_STATUSES:
            task.completed_at = datetime.datetime.now().isoformat()
        else:
            task.completed_at = None
    if "priority" in body:
        task.priority = body["priority"]
    if "acceptance_criteria" in body:
        ac = body["acceptance_criteria"] if isinstance(body["acceptance_criteria"], list) else []
        task.acceptance_criteria = json.dumps(ac)
    if "testing_methods" in body:
        tm = body["testing_methods"] if isinstance(body["testing_methods"], list) else []
        task.testing_methods = json.dumps(tm)
    if "validation_steps" in body:
        vs = body["validation_steps"] if isinstance(body["validation_steps"], list) else []
        task.validation_steps = json.dumps(vs)

    await task.save()
    return JSONResponse(_serialize(task))


async def destroy(request: Request, task_id: int):
    task = await Task.find(task_id)
    if not task:
        return JSONResponse({"error": "not found"}, status_code=404)
    await task.delete()
    return JSONResponse({}, status_code=204)
