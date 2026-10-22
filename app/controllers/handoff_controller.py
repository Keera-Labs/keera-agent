import socket

from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi_startkit import Config

from app.actions.agent_handoff_import_action import AgentHandoffImportAction
from app.requests.handoff_request import IncomingHandoffRequest
from app.services.handoff.auth import verify_handoff_token


async def show(request: Request):
    verify_handoff_token(request.headers.get("authorization"))
    return JSONResponse(
        {
            "data": {
                "name": Config.get("fastapi.server_name") or socket.gethostname(),
                "base_url": Config.get("fastapi.app_url"),
                "providers": ["claude"],
            }
        }
    )


async def store(request: Request, body: IncomingHandoffRequest):
    verify_handoff_token(request.headers.get("authorization"))
    result = await AgentHandoffImportAction(body).execute()
    return JSONResponse({"data": result})
