import socket
from typing import Annotated

from fastapi import Depends, Request
from fastapi.responses import JSONResponse
from fastapi_startkit import Config

from app.actions.agent_handoff_import_action import AgentHandoffImportAction, plan_target
from app.requests.handoff_request import (
    HandoffPreflightRequest,
    IncomingHandoffRequest,
    read_bounded_body,
)
from app.services.handoff.auth import require_handoff_token

Authenticated = Annotated[None, Depends(require_handoff_token)]


async def show(_: Authenticated):
    return JSONResponse(
        {
            "data": {
                "name": Config.get("fastapi.server_name") or socket.gethostname(),
                "base_url": Config.get("fastapi.app_url"),
                "providers": ["claude"],
            }
        }
    )


async def preflight(request: Request, _: Authenticated):
    body = await read_bounded_body(request, HandoffPreflightRequest)
    project, model = await plan_target(body.remote_url, body.agent)
    return JSONResponse({"data": {"project_id": project.id, "model": model}})


async def store(request: Request, _: Authenticated):
    body = await read_bounded_body(request, IncomingHandoffRequest)
    return JSONResponse({"data": await AgentHandoffImportAction(body).execute()})
