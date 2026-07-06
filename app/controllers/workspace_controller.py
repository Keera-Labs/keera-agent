from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Project import Project
from app.models.Workspace import Workspace


async def index(request: Request):
    workspaces = await Workspace.all()
    result = []
    for w in workspaces:
        projects = await Project.where("workspace_id", w.id).get()
        result.append(
            {
                "id": w.id,
                "name": w.name,
                "description": w.description,
                "projects": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "slug": p.slug,
                        "path": p.path,
                        "language": p.language,
                        "workspace_id": p.workspace_id,
                    }
                    for p in projects
                ],
            }
        )
    return JSONResponse(result)


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
            "projects": [],
        },
        status_code=201,
    )


async def update(request: Request, workspace_id: int):
    body = await request.json()

    workspace = await Workspace.find(workspace_id)
    if not workspace:
        return JSONResponse({"error": "Workspace not found"}, status_code=404)

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
    workspace = await Workspace.find(workspace_id)
    if not workspace:
        return JSONResponse({"error": "Workspace not found"}, status_code=404)

    # Unlink projects before deleting
    projects = await Project.where("workspace_id", workspace_id).get()
    for p in projects:
        p.workspace_id = None
        await p.save()

    await Workspace.where("id", workspace_id).delete()
    return JSONResponse({"ok": True})
