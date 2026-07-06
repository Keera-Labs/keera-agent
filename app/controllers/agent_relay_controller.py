import os

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Agent import Agent
from app.models.AgentRelayMessage import AgentRelayMessage
from app.models.Project import Project


def _serialize(m: AgentRelayMessage) -> dict:
    return {
        "id": m.id,
        "from_agent_id": m.from_agent_id,
        "to_agent_id": m.to_agent_id,
        "content": m.content,
        "status": m.status,
        "created_at": str(m.created_at) if m.created_at else None,
    }


async def relay(request: Request):
    """
    Called by Claude agents via curl to send a message to another agent.
    Immediately injects into the target agent's PTY if it's running,
    otherwise queues the message for delivery on next connect.
    """
    body = await request.json()
    from_agent_id = body.get("from_agent_id")
    to_agent_id = body.get("to_agent_id")
    content = (body.get("content") or "").strip()

    if not from_agent_id or not to_agent_id or not content:
        return JSONResponse(
            {"error": "from_agent_id, to_agent_id and content are required"}, status_code=400
        )

    from_agent = await Agent.find(from_agent_id)
    to_agent = await Agent.find(to_agent_id)

    if not from_agent:
        return JSONResponse({"error": f"Agent {from_agent_id} not found"}, status_code=404)
    if getattr(from_agent, "deleted_at", None):
        return JSONResponse(
            {"error": f"Agent {from_agent_id} not found or has been deleted"}, status_code=404
        )
    if not to_agent:
        return JSONResponse({"error": f"Agent {to_agent_id} not found"}, status_code=404)
    if getattr(to_agent, "deleted_at", None):
        return JSONResponse(
            {"error": f"Agent {to_agent_id} not found or has been deleted"}, status_code=404
        )

    from app.actions.agent_message_send_action import AgentMessageSendAction

    msg_id, delivered = await AgentMessageSendAction.prepare(
        from_agent, to_agent, content
    ).execute()

    # Notify the frontend WebSocket so the UI updates
    import json as _json

    from fastapi_startkit.application import app as _app

    from app.terminal.connection_manager import ConnectionManager

    project = await Project.find(to_agent.project_id)
    conn_manager: ConnectionManager = _app().make("connections")
    if project:
        cwd = os.path.expanduser(project.path)
        ui_bridge = conn_manager.find_by_cwd(cwd)
        if ui_bridge:
            try:
                await ui_bridge.write(
                    _json.dumps(
                        {
                            "type": "agent_relay_message",
                            "message_id": msg_id,
                            "from_agent_id": from_agent_id,
                            "from_agent_name": from_agent.name,
                            "to_agent_id": to_agent_id,
                            "to_agent_name": to_agent.name,
                            "content": content,
                            "status": "delivered" if delivered else "pending",
                        }
                    )
                )
            except Exception:
                pass

    return JSONResponse(
        {
            "id": msg_id,
            "delivered": delivered,
            "status": "delivered" if delivered else "pending",
        }
    )


async def get_messages(request: Request, agent_id: int):
    """Return all relay messages sent to or from an agent."""
    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)

    sent = await AgentRelayMessage.where("from_agent_id", agent_id).get()
    received = await AgentRelayMessage.where("to_agent_id", agent_id).get()

    all_msgs = sorted(list(sent) + list(received), key=lambda m: m.id)
    return JSONResponse([_serialize(m) for m in all_msgs])
