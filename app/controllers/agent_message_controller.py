from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.AgentMessage import AgentMessage
from app.models.Project import Project


def _serialize(m: AgentMessage, sender: Project | None, receiver: Project | None) -> dict:
    return {
        "id": m.id,
        "sender_project_id": m.sender_project_id,
        "receiver_project_id": m.receiver_project_id,
        "sender_name": sender.name if sender else str(m.sender_project_id),
        "receiver_name": receiver.name if receiver else str(m.receiver_project_id),
        "content": m.content,
        "status": m.status,
        "created_at": str(m.created_at),
    }


async def index(request: Request, project_id: int):
    """Return all messages sent to or from this project."""
    messages = (
        await AgentMessage.where("sender_project_id", project_id)
        .or_where("receiver_project_id", project_id)
        .order_by("id", "asc")
        .get()
    )

    projects = await Project.all()
    proj_map = {p.id: p for p in projects}

    return JSONResponse(
        [
            _serialize(m, proj_map.get(m.sender_project_id), proj_map.get(m.receiver_project_id))
            for m in messages
        ]
    )


async def mark_read(request: Request, message_id: int):
    """Mark a message as read."""
    msg = await AgentMessage.find_or_fail(message_id)
    msg.status = "read"
    await msg.save()
    return JSONResponse({"id": msg.id, "status": msg.status})
