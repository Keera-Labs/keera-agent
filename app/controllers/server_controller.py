from fastapi.responses import Response

from app.actions.agent_status_action import utc_now
from app.models.Server import Server
from app.requests.server_request import ServerStoreRequest, ServerUpdateRequest
from app.resources.server_resource import ServerResource


async def index():
    servers = await Server.order_by("name", "asc").get()
    return ServerResource.collection(servers)


async def store(body: ServerStoreRequest):
    now = utc_now()
    server = await Server.create({**body.model_dump(), "created_at": now, "updated_at": now})
    return ServerResource(await Server.find(server.id))


async def update(body: ServerUpdateRequest, server_id: int):
    await Server.find_or_fail(server_id)
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if changes:
        await Server.where("id", server_id).update({**changes, "updated_at": utc_now()})
    return ServerResource(await Server.find_or_fail(server_id))


async def destroy(server_id: int):
    await Server.find_or_fail(server_id)
    await Server.where("id", server_id).delete()
    return Response(status_code=204)
