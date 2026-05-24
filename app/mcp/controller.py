"""
MCP JSON-RPC 2.0 controller.

Single endpoint (POST /mcp) that handles the entire MCP Streamable HTTP
transport.  No third-party MCP library required — MCP is just JSON-RPC 2.0.

Supported methods:
  initialize          → handshake, return server capabilities
  notifications/*     → acknowledge (no response body needed)
  tools/list          → return tool schemas
  tools/call          → invoke a tool handler and return its output
  resources/list      → list available resources
  resources/read      → read a resource by URI

Resources:
  keera://tasks/active   — pending + in_progress tasks for the project
                           resolved via X-Project-Path request header
"""

import json
import os

from fastapi import Request
from fastapi.responses import JSONResponse

from app.mcp.tools import TOOLS, HANDLERS

PROTOCOL_VERSION = "2024-11-05"
SERVER_INFO = {"name": "keera-agent", "version": "1.0.0"}

ACTIVE_TASKS_URI = "keera://tasks/active"


# ── JSON-RPC helpers ──────────────────────────────────────────────────────────

def ok(rpc_id, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": rpc_id, "result": result}


def err(rpc_id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": code, "message": message}}


def text_content(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}]}


# ── resources ─────────────────────────────────────────────────────────────────

async def _fetch_active_tasks(project_path: str | None) -> str:
    from app.models.Project import Project
    from app.models.Task import Task

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
        lines.append(f"{status_label} #{t.id} {t.title or t.description}  ({t.priority or 'medium'})")
        ac = _load(t.acceptance_criteria)
        if ac:
            for c in ac:
                lines.append(f"     • {c}")
    return "\n".join(lines)


# ── method handlers ───────────────────────────────────────────────────────────

async def _initialize(rpc_id, _params: dict, **_) -> dict:
    return ok(rpc_id, {
        "protocolVersion": PROTOCOL_VERSION,
        "serverInfo": SERVER_INFO,
        "capabilities": {
            "tools": {},
            "resources": {},
        },
    })


async def _tools_list(rpc_id, _params: dict, **_) -> dict:
    return ok(rpc_id, {"tools": TOOLS})


async def _tools_call(rpc_id, params: dict, **_) -> dict:
    name = params.get("name", "")
    args = params.get("arguments") or {}

    handler = HANDLERS.get(name)
    if not handler:
        return err(rpc_id, -32601, f"Unknown tool: {name}")

    try:
        result_text = await handler(args)
        return ok(rpc_id, text_content(result_text))
    except Exception as exc:
        return ok(rpc_id, text_content(f"Error: {exc}"))


async def _resources_list(rpc_id, _params: dict, project_path: str | None = None, **_) -> dict:
    resources = [
        {
            "uri": ACTIVE_TASKS_URI,
            "name": "Active Tasks",
            "description": "Pending and in-progress tasks for this project. Read this at the start of every session.",
            "mimeType": "text/plain",
        }
    ]
    return ok(rpc_id, {"resources": resources})


async def _resources_read(rpc_id, params: dict, project_path: str | None = None, **_) -> dict:
    uri = params.get("uri", "")
    if uri != ACTIVE_TASKS_URI:
        return err(rpc_id, -32602, f"Unknown resource URI: {uri}")

    text = await _fetch_active_tasks(project_path)
    return ok(rpc_id, {
        "contents": [
            {
                "uri": ACTIVE_TASKS_URI,
                "mimeType": "text/plain",
                "text": text,
            }
        ]
    })


# ── dispatcher ────────────────────────────────────────────────────────────────

_METHODS = {
    "initialize":       _initialize,
    "tools/list":       _tools_list,
    "tools/call":       _tools_call,
    "resources/list":   _resources_list,
    "resources/read":   _resources_read,
}


async def handle(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(err(None, -32700, "Parse error"), status_code=400)

    method = body.get("method", "")
    rpc_id = body.get("id")          # None for notifications
    params = body.get("params") or {}

    # Notifications (no id) — just acknowledge
    if rpc_id is None:
        return JSONResponse({}, status_code=202)

    fn = _METHODS.get(method)
    if not fn:
        return JSONResponse(err(rpc_id, -32601, f"Method not found: {method}"))

    # Pass project_path from header so resources know which project to scope to
    project_path = request.headers.get("X-Project-Path")
    response = await fn(rpc_id, params, project_path=project_path)
    return JSONResponse(response)
