import re

from fastapi import Request
from fastapi_startkit.inertia.inertia import Inertia

from app.models.Project import Project
from app.models.Task import Task


def _slugify(name: str) -> str:
    s = name.lower()
    s = re.sub(r'\s+', '-', s)
    s = re.sub(r'[^a-z0-9-]', '', s)
    s = re.sub(r'-+', '-', s)
    return s.strip('-')


def _load_json(value) -> list:
    if not value:
        return []
    try:
        import json
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
    }


async def tasks_page(request: Request, project: str):
    projects = await Project.all()
    proj = next((p for p in projects if _slugify(p.name) == project), None)
    tasks = []
    if proj:
        raw = await Task.where("project_id", proj.id).get()
        tasks = [_serialize(t) for t in raw]
    return Inertia.render("Tasks", {
        "project": project,
        "project_id": proj.id if proj else None,
        "tasks": tasks,
    })
