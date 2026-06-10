from fastapi import Request
from fastapi.responses import JSONResponse

from fastapi_startkit.broadcasting.helpers import broadcast
from app.events.test_event import TestBroadcastEvent


async def fire(request: Request):
    body = await request.json()
    message = body.get('message', 'Hello from server!')
    await broadcast(TestBroadcastEvent(message))
    return JSONResponse({'status': 'broadcast sent', 'message': message})
