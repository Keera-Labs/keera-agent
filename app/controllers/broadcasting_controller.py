from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi_startkit.broadcasting.helpers import broadcast
from fastapi_startkit.inertia.inertia import Inertia

from app.events.ping_event import PingEvent


async def broadcasting_page(request: Request):
    return Inertia.render("Broadcasting", {})


async def ping(request: Request):
    body = await request.json()
    message = (body.get("message") or "ping").strip() or "ping"
    await broadcast(PingEvent(message))
    return JSONResponse({"status": "ok", "message": message})
