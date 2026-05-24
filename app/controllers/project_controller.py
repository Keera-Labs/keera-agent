import os

from fastapi import Request, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi_startkit.environment import env
from fastapi_startkit.storage.storage import Storage

from app.models.AgentMessage import AgentMessage
from app.models.Project import Project
from app.utils.hook_setup import ensure_claude_settings


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
            "system_prompt": p.system_prompt,
        }
        for p in projects
    ])


async def validate_path(request: Request):
    path = request.query_params.get("path", "").strip()
    if not path:
        return JSONResponse({"exists": False, "expanded": ""})
    expanded = os.path.expanduser(path)
    return JSONResponse({"exists": os.path.isdir(expanded), "expanded": expanded})


async def update(request: Request, project_id: int):
    body = await request.json()

    project = await Project.find(project_id)
    if not project:
        return JSONResponse({"error": "Project not found"}, status_code=404)

    if "workspace_id" in body:
        project.workspace_id = body["workspace_id"]  # None = unassign

    if "path" in body:
        new_path = (body.get("path") or "").strip()
        if not new_path:
            return JSONResponse({"error": "Path is required"}, status_code=422)
        expanded = os.path.expanduser(new_path)
        if not os.path.isdir(expanded):
            return JSONResponse({"error": "Directory does not exist"}, status_code=422)
        project.path = new_path
        base_url = env("APP_URL", "http://localhost:8000")
        ensure_claude_settings(expanded, base_url)

    if "system_prompt" in body:
        project.system_prompt = body["system_prompt"] or None

    await project.save()

    return JSONResponse({
        "id": project.id,
        "name": project.name,
        "path": project.path,
        "language": project.language,
        "workspace_id": project.workspace_id,
        "claude_status": project.claude_status,
        "system_prompt": project.system_prompt,
    })


async def destroy(request: Request, project_id: int):
    project = await Project.find(project_id)
    if not project:
        return JSONResponse({"error": "Project not found"}, status_code=404)
    try:
        # Cascade-delete related records before removing the project
        from app.models.Task import Task
        from app.models.Command import Command
        await Task.where("project_id", project_id).delete()
        await Command.where("project_id", project_id).delete()
        await AgentMessage.where("receiver_project_id", project_id).delete()
        await AgentMessage.where("sender_project_id", project_id).delete()
        await Project.where("id", project_id).delete()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    return JSONResponse({"ok": True})


async def upload_image(request: Request, project_id: int, file: UploadFile = File(...)):
    project = await Project.find(project_id)
    if not project:
        return JSONResponse({"error": "Project not found"}, status_code=404)

    if not file.content_type or not file.content_type.startswith("image/"):
        return JSONResponse({"error": "Only image files are supported"}, status_code=422)

    filename = file.filename or "image"
    base, ext = os.path.splitext(filename)
    rel_path = f"uploads/{project_id}/{filename}"
    driver = Storage.disk("local")
    counter = 1
    while driver.exists(rel_path):
        rel_path = f"uploads/{project_id}/{base}_{counter}{ext}"
        counter += 1

    content = await file.read()
    driver.put(rel_path, content)

    return JSONResponse({"path": driver.get_path(rel_path)})


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

    expanded_path = os.path.expanduser(path)
    base_url = env("APP_URL", "http://localhost:8000")
    ensure_claude_settings(expanded_path, base_url, apply_default_permissions=True)

    return JSONResponse(
        {
            "id": project.id,
            "name": project.name,
            "path": project.path,
            "language": project.language,
            "workspace_id": project.workspace_id,
            "system_prompt": project.system_prompt,
        },
        status_code=201,
    )
