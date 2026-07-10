"""Keera MCP server — KeeraServer and its resources."""

import json
import logging
import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from fastapi.responses import Response as StarletteResponse
from fastapi_startkit.mcp import JsonRpcRequest, Resource, Server
from fastapi_startkit.mcp.protocol import Protocol

from app.mcp.browser_tools import BROWSER_TOOLS
from app.mcp.tools import KEERA_TOOLS

logger = logging.getLogger("keera.mcp")


class ActiveTasksResource(Resource):
    uri = "keera://tasks/active"
    name = "active_tasks"
    description = (
        "Pending and in-progress tasks for this project. Read this at the start of every session."
    )
    mime_type = "text/plain"

    async def read(self, **kwargs) -> str:
        from app.models.Project import Project
        from app.models.Task import Task

        project_path = kwargs.get("project_path")
        project = None
        if project_path:
            expanded = os.path.expanduser(project_path).rstrip("/")
            projects = await Project.all()
            for p in projects:
                if os.path.expanduser(p.path).rstrip("/") == expanded:
                    project = p
                    break

        if not project:
            return "No project found. Set the X-Project-Path header to your project directory."

        tasks = await (
            Task.where("project_id", project.id)
            .where_in("status", ["pending", "in_progress"])
            .order_by("id", "asc")
            .get()
        )

        if not tasks:
            return f"No pending or in-progress tasks for project '{project.name}'."

        def _load(v):
            try:
                return json.loads(v) if v else []
            except (ValueError, TypeError):
                return []

        lines = [f"Active tasks for '{project.name}':", ""]
        for t in tasks:
            status_label = "[ ]" if t.status == "pending" else "[→]"
            lines.append(f"{status_label} #{t.id} {t.title or t.body}  ({t.priority or 'medium'})")
            for c in _load(t.acceptance_criteria):
                lines.append(f"     • {c}")
        return "\n".join(lines)


class KeeraServer(Server):
    name = "keera-agent"
    description = "Keera project management MCP server."
    instructions = "Call tools/list to see available tools. Use list_tasks or the keera://tasks/active resource to see current work."

    def tools(self):
        return KEERA_TOOLS + BROWSER_TOOLS + _active_plugin_tools()

    def resources(self):
        return [ActiveTasksResource]

    def router(self, prefix: str = "/mcp") -> APIRouter:
        """Robust JSON-RPC 2.0 endpoint.

        The stock base handler does a bare ``await request.json()``, which
        raises ``JSONDecodeError: Extra data`` (→ 500) when a client posts two
        JSON-RPC objects concatenated in one body ({...}{...} or {...}\\n{...})
        instead of a JSON array batch. This override parses leniently, logs the
        raw body when parsing is anything but a clean single object, and never
        lets an exception escape as a 500.
        """
        protocol = Protocol(self)
        api_router = APIRouter(prefix=prefix)

        @api_router.post("")
        async def handle_post(request: Request) -> StarletteResponse:
            raw = (await request.body()).decode("utf-8", "replace")
            try:
                messages, is_batch = _parse_messages(raw)
            except ValueError as exc:
                logger.warning("MCP POST: unparseable body (%s): %r", exc, raw)
                return JSONResponse(
                    content=_error(None, -32700, f"Parse error: {exc}"),
                    status_code=200,
                )

            if is_batch:
                logger.warning(
                    "MCP POST: recovered %d concatenated/batch messages from body: %r",
                    len(messages),
                    raw,
                )

            responses = []
            for message in messages:
                result = await _dispatch_message(protocol, message)
                if result is not None:
                    responses.append(result)

            if not responses:
                # All notifications (or empty batch): nothing to return.
                return StarletteResponse(status_code=202)

            if is_batch:
                return JSONResponse(content=responses)
            return JSONResponse(content=responses[0])

        @api_router.get("")
        async def handle_get() -> StarletteResponse:
            return StarletteResponse(status_code=405, headers={"Allow": "POST"})

        return api_router


def _active_plugin_tools() -> list:
    """MCP tools contributed by currently-active plugins (empty if none)."""
    try:
        from fastapi_startkit.application import app

        return app().make("plugins").active_tool_classes()
    except Exception:
        logging.getLogger("keera.plugins").exception("Failed to collect active plugin MCP tools")
        return []


def _parse_messages(raw: str) -> tuple[list, bool]:
    """Parse a request body into a list of JSON-RPC messages.

    Returns ``(messages, is_batch)``. A single JSON object yields one message
    with ``is_batch=False``. A JSON array, or multiple objects concatenated in
    one body (``{...}{...}`` / ``{...}\\n{...}``), yields ``is_batch=True``.
    Raises ``ValueError`` when nothing parseable is found.
    """
    stripped = raw.strip()
    if not stripped:
        raise ValueError("empty body")

    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, list):
            return parsed, True
        return [parsed], False
    except json.JSONDecodeError:
        # Fall back to decoding concatenated JSON values one at a time.
        return _decode_concatenated(stripped), True


def _decode_concatenated(text: str) -> list:
    """Decode back-to-back JSON values, tolerating whitespace between them."""
    decoder = json.JSONDecoder()
    messages: list = []
    index = 0
    length = len(text)
    while index < length:
        while index < length and text[index] in " \t\r\n":
            index += 1
        if index >= length:
            break
        obj, end = decoder.raw_decode(text, index)  # raises JSONDecodeError → ValueError
        messages.append(obj)
        index = end
    if not messages:
        raise ValueError("no JSON values found")
    return messages


async def _dispatch_message(protocol: Protocol, message) -> dict | None:
    """Dispatch one JSON-RPC message. Returns None for notifications.

    Malformed messages return a JSON-RPC error rather than raising, so a single
    bad entry never fails the whole request.
    """
    if not isinstance(message, dict):
        return _error(None, -32600, "Invalid Request: not a JSON object")

    try:
        rpc = JsonRpcRequest(**message)
    except Exception as exc:
        return _error(message.get("id"), -32600, f"Invalid Request: {exc}")

    result = await protocol.dispatch(rpc.method, rpc.params, rpc.id)
    return None if rpc.is_notification else result


def _error(request_id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}
