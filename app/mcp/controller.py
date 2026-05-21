"""
MCP JSON-RPC 2.0 controller.

Single endpoint (POST /mcp) that handles the entire MCP Streamable HTTP
transport.  No third-party MCP library required — MCP is just JSON-RPC 2.0.

Supported methods:
  initialize          → handshake, return server capabilities
  notifications/*     → acknowledge (no response body needed)
  tools/list          → return tool schemas
  tools/call          → invoke a tool handler and return its output
"""

from fastapi import Request
from fastapi.responses import JSONResponse

from app.mcp.tools import TOOLS, HANDLERS

PROTOCOL_VERSION = "2024-11-05"
SERVER_INFO = {"name": "keera-agent", "version": "1.0.0"}


# ── JSON-RPC helpers ──────────────────────────────────────────────────────────

def ok(rpc_id, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": rpc_id, "result": result}


def err(rpc_id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": code, "message": message}}


def text_content(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}]}


# ── method handlers ───────────────────────────────────────────────────────────

async def _initialize(rpc_id, _params: dict) -> dict:
    return ok(rpc_id, {
        "protocolVersion": PROTOCOL_VERSION,
        "serverInfo": SERVER_INFO,
        "capabilities": {"tools": {}},
    })


async def _tools_list(rpc_id, _params: dict) -> dict:
    return ok(rpc_id, {"tools": TOOLS})


async def _tools_call(rpc_id, params: dict) -> dict:
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


# ── dispatcher ────────────────────────────────────────────────────────────────

_METHODS = {
    "initialize": _initialize,
    "tools/list": _tools_list,
    "tools/call": _tools_call,
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

    response = await fn(rpc_id, params)
    return JSONResponse(response)
