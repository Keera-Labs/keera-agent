import json
import shlex

from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi_startkit.process import Process
from fastapi_startkit.broadcasting.helpers import broadcast

from app.events.ai_response_event import AiResponseEvent


async def chat(request: Request):
    body = await request.json()
    message = (body.get("message") or "").strip()
    if not message:
        return JSONResponse({"error": "message is required"}, status_code=400)

    # Use the claude CLI in print mode via the Process facade
    cmd = f"claude -p {shlex.quote(message)} --output-format json"
    result = await Process.forever().run(cmd)

    if result.failed():
        return JSONResponse({"error": result.stderr or "claude process failed"}, status_code=500)

    try:
        data = json.loads(result.stdout)
        response_text = data.get("result", "") or result.stdout.strip()
    except (json.JSONDecodeError, ValueError):
        response_text = result.stdout.strip()

    await broadcast(AiResponseEvent(message, response_text))

    return JSONResponse({"response": response_text})
