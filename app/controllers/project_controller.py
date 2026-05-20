import os

from fastapi import Request, UploadFile, File
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


async def update(request: Request, project_id: int):
    body = await request.json()

    project = await Project.find(project_id)
    if not project:
        return JSONResponse({"error": "Project not found"}, status_code=404)

    if "workspace_id" in body:
        project.workspace_id = body["workspace_id"]  # None = unassign

    await project.save()

    return JSONResponse({
        "id": project.id,
        "name": project.name,
        "path": project.path,
        "language": project.language,
        "workspace_id": project.workspace_id,
        "claude_status": project.claude_status,
    })


async def upload_image(request: Request, project_id: int, file: UploadFile = File(...)):
    project = await Project.find(project_id)
    if not project:
        return JSONResponse({"error": "Project not found"}, status_code=404)

    if not file.content_type or not file.content_type.startswith("image/"):
        return JSONResponse({"error": "Only image files are supported"}, status_code=422)

    project_path = os.path.expanduser(project.path)
    uploads_dir = os.path.join(project_path, ".keera", "uploads")
    os.makedirs(uploads_dir, exist_ok=True)

    filename = file.filename or "image"
    dest = os.path.join(uploads_dir, filename)
    base, ext = os.path.splitext(filename)
    counter = 1
    while os.path.exists(dest):
        dest = os.path.join(uploads_dir, f"{base}_{counter}{ext}")
        counter += 1

    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)

    return JSONResponse({"path": dest})


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
