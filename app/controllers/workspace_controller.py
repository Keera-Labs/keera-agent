from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Project import Project
from app.models.Workspace import Workspace


async def index(request: Request):
    workspaces = await Workspace.all()
    return JSONResponse(
        [{"id": w.id, "name": w.name, "description": w.description} for w in workspaces]
    )


async def store(request: Request):
    body = await request.json()

    name = (body.get("name") or "").strip()
    description = (body.get("description") or "").strip() or None

    if not name:
        return JSONResponse({"error": "name is required"}, status_code=422)

    workspace = await Workspace.create({"name": name, "description": description})

    return JSONResponse(
        {
            "id": workspace.id,
            "name": workspace.name,
            "description": workspace.description,
        },
        status_code=201,
    )


async def update(request: Request, workspace_id: int):
    body = await request.json()

    workspace = await Workspace.find_or_fail(workspace_id)

    name = (body.get("name") or "").strip()
    description = body.get("description")

    if name:
        workspace.name = name
    if description is not None:
        workspace.description = description.strip() or None

    await workspace.save()

    return JSONResponse(
        {"id": workspace.id, "name": workspace.name, "description": workspace.description}
    )


async def destroy(request: Request, workspace_id: int):
    await Workspace.find_or_fail(workspace_id)

    # Unlink projects before deleting
    projects = await Project.where("workspace_id", workspace_id).get()
    for p in projects:
        p.workspace_id = None
        await p.save()

    await Workspace.where("id", workspace_id).delete()
    return JSONResponse({"ok": True})
