from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Project import Project
from app.models.Workspace import Workspace
from app.requests.workspace_request import WorkspaceUpdateRequest
from app.resources.workspace_resource import WorkspaceResource


async def index(request: Request):
    return WorkspaceResource.collection(await Workspace.all())


async def store(request: Request):
    body = await request.json()

    name = (body.get("name") or "").strip()
    description = (body.get("description") or "").strip() or None

    if not name:
        return JSONResponse({"error": "name is required"}, status_code=422)

    workspace = await Workspace.create({"name": name, "description": description})

    return JSONResponse(WorkspaceResource(workspace).serialize(), status_code=201)


async def update(request: WorkspaceUpdateRequest, workspace_id: int):
    workspace = await Workspace.find_or_fail(workspace_id)

    data = request.model_dump(exclude_unset=True)
    # A name can be renamed but never cleared.
    if data.get("name") is None:
        data.pop("name", None)
    if data:
        await workspace.update(data)

    return WorkspaceResource(workspace)


async def destroy(request: Request, workspace_id: int):
    await Workspace.find_or_fail(workspace_id)

    # Unlink projects before deleting
    projects = await Project.where("workspace_id", workspace_id).get()
    for p in projects:
        p.workspace_id = None
        await p.save()

    await Workspace.where("id", workspace_id).delete()
    return JSONResponse({"ok": True})
