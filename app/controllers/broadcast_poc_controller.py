import asyncio
import shlex

from fastapi import Request
from fastapi.responses import JSONResponse

from fastapi_startkit.broadcasting.helpers import broadcast
from app.events.test_event import TestBroadcastEvent
from app.events.ai_chat_event import AIChatResponseEvent
from app.utils.process import Process


async def _call_claude(message: str) -> None:
    quoted = shlex.quote(message)
    cmd = f"claude -p {quoted}"
    try:
        result = await Process.run_async(cmd, timeout=60)
        if result.successful():
            await broadcast(AIChatResponseEvent(response=result.output().strip(), error=False))
        else:
            err_text = result.error().strip() or f"claude exited with code {result.exit_code()}"
            await broadcast(AIChatResponseEvent(response=err_text, error=True))
    except asyncio.TimeoutError:
        await broadcast(AIChatResponseEvent(response="Request timed out after 60 seconds.", error=True))
    except Exception as exc:
        await broadcast(AIChatResponseEvent(response=f"Unexpected error: {exc}", error=True))


async def fire(request: Request):
    body = await request.json()
    message = body.get('message', '')

    await broadcast(TestBroadcastEvent(message))

    asyncio.create_task(_call_claude(message))

    return JSONResponse({'status': 'ok'})
