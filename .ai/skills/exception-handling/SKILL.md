---
name: exception-handling
description: Add, change, or review exception handling, try/except logic, and error reporting in keera-agent, including HTTP controllers, streams, background tasks, and MCP tools.
---

# Exception Handling

## Default: propagate

Let exceptions reach the global handlers registered in `app/exceptions/handlers.py` (called from `app/providers/app_provider.py`). Map a domain failure to an HTTP status there once, instead of re-implementing it in each controller.

Before adding a catch, identify what must happen differently: translation, recovery, cleanup, or handling at a boundary the global handler cannot reach. If nothing differs, omit the catch.

- Missing records: use `find_or_fail()`. `ModelNotFoundException` is already mapped to a 404 `{"error": ...}` response.
- Expected failures in a controller (validation of business state, unsupported action, upstream rejection): return `JSONResponse({"error": "<client-safe message>"}, status_code=<status>)`.
- New exception types that need a status: add a handler in `app/exceptions/handlers.py` and register it in `register_exception_handlers`.
- Do not hand-build error dictionaries inside services or actions. Raise a typed exception; let the controller or handler render it.

### Example: map a missing record

```python
from fastapi.responses import JSONResponse

from app.models.Task import Task


async def show(task_id: int) -> JSONResponse:
    task = await Task.find_or_fail(task_id)
    return JSONResponse({"data": task.serialize()})
```

No local catch is needed; the 404 comes from the registered handler.

### Wrong: catch everything, log, and replace the error

```python
async def show(task_id: int):
    try:
        return await Task.find_or_fail(task_id)
    except Exception as exc:
        logger.exception("Task lookup failed")
        return JSONResponse({"error": str(exc)}, status_code=500)
```

This turns a 404 into a 500, duplicates reporting, and exposes raw exception text. Correct: let `find_or_fail()` raise and keep the controller free of the catch.

## Justified catches

Catch the narrowest type you can handle and keep the `try` block around the operation that can produce it. Name the handling function for the outcome so the reason is visible without a comment.

### Translate an external failure

Translate a known library error when it has a specific application meaning. Preserve the cause with `raise ... from exc` and use a client-safe message.

```python
import httpx


class UpstreamUnavailableError(Exception):
    pass


async def fetch_usage(client: httpx.AsyncClient, url: str):
    try:
        return await client.get(url)
    except httpx.TimeoutException as exc:
        raise UpstreamUnavailableError("Usage provider is unavailable.") from exc
```

Do not translate unrelated network or programming failures into the same error without a reason. Map `UpstreamUnavailableError` to a status in `app/exceptions/handlers.py` if it reaches a controller.

### Recover with a deliberate fallback

Use a fallback only when missing or invalid data is acceptable to the caller. Invalid required input must still fail.

```python
import json


def parse_optional_metadata(raw: str) -> dict:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}
```

### Release resources or roll back

Prefer a context manager, transaction, or `finally` for cleanup. Catch for compensation only when those mechanisms cannot undo partial work, and re-raise with bare `raise` afterwards.

```python
async def consume_stream(stream, consume):
    try:
        return await consume(stream)
    finally:
        await stream.aclose()
```

### Handle a failure outside the HTTP handler

Once a stream has started (for example the terminal WebSocket in `app/terminal`), an exception cannot become an HTTP error response. Send a safe error event through the stream's existing protocol, or close the socket, and log the traceback.

```python
import logging

logger = logging.getLogger(__name__)


async def stream_with_errors(events, encode_error):
    try:
        async for event in events:
            yield event
    except Exception:
        logger.exception("Terminal stream failed")
        yield encode_error("Something went wrong")
```

- Background tasks and workers: let failures propagate so their failure tracking applies. Catch only to change that outcome deliberately.
- MCP tools (`app/mcp/tools.py`): when recovery is intended, return an error result for that tool call and sanitize details before they reach the caller.
- Never use bare `except:` or catch `BaseException`. Preserve cancellation and shutdown signals.
- Use `except Exception` only for justified compensation that re-raises, or a boundary that deliberately consumes failures. A consuming boundary must log with `logger.exception(...)`.
- Do not put credentials, request bodies, or raw exception text in client-visible responses. Keep log context to safe identifiers such as project path or task id.

## Verify the changed behavior

For behavioral changes, check the intended outcome: the translated type and cause, a fallback only for the expected exception, unrelated failures still propagating, or the boundary's safe error event and traceback log. Check the HTTP status and the `{"error": ...}` body for affected routes. Do not refactor unrelated existing catches as part of a local change.
