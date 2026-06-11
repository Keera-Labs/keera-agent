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

    cmd = f"claude -p {shlex.quote(message)} --output-format json </dev/null"
    result = await Process.forever().run(cmd)

    if result.failed():
        return JSONResponse({"error": result.error() or "claude process failed"}, status_code=500)

    try:
        data = result.output_json()
        response_text = data.get("result", "") or result.output().strip()
    except (ValueError, KeyError):
        response_text = result.output().strip()

    await broadcast(AiResponseEvent(message, response_text))

    return JSONResponse({"response": response_text})
