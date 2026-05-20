import os

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Project import Project


async def index(request: Request):
    projects = await Project.all()
    return JSONResponse([
        {
            "id": p.id,
            "name": p.name,
            "path": p.path,
            "language": p.language,
            "workspace_id": p.workspace_id,
            "claude_status": p.claude_status,
        }
        for p in projects
    ])


async def validate_path(request: Request):
    path = request.query_params.get("path", "").strip()
    if not path:
        return JSONResponse({"exists": False, "expanded": ""})
    expanded = os.path.expanduser(path)
    return JSONResponse({"exists": os.path.isdir(expanded), "expanded": expanded})


async def store(request: Request):
    body = await request.json()

    name = (body.get("name") or "").strip()
    path = (body.get("path") or "").strip()
    language = (body.get("language") or "Unknown").strip()
    workspace_id = body.get("workspace_id") or None

    if not name or not path:
        return JSONResponse({"error": "name and path are required"}, status_code=422)

    existing = await Project.where("name", name).first()
    if existing:
        return JSONResponse({"error": "A project with that name already exists"}, status_code=409)

    project = await Project.create({
        "name": name,
        "path": path,
        "language": language,
        "workspace_id": workspace_id,
    })

    return JSONResponse(
        {
            "id": project.id,
            "name": project.name,
            "path": project.path,
            "language": project.language,
            "workspace_id": project.workspace_id,
        },
        status_code=201,
    )
