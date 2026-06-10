from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi_startkit.broadcasting.helpers import broadcast

from app.ai.chat_agent import ChatAgent
from app.events.ai_response_event import AiResponseEvent


async def chat(request: Request):
    body = await request.json()
    message = (body.get("message") or "").strip()
    if not message:
        return JSONResponse({"error": "message is required"}, status_code=400)

    agent = ChatAgent()
    response = agent.prompt(message)

    await broadcast(AiResponseEvent(message, response.content))

    return JSONResponse({"response": response.content})
