"""Integration tests for the MCP framework HTTP endpoints.

These tests build a minimal FastAPI app with a test MCP server and verify
the JSON-RPC 2.0 transport end-to-end.
"""

import sys
import os
import unittest

from httpx import AsyncClient, ASGITransport
from fastapi import FastAPI

# Add packages/ to sys.path so `mcp` is importable as a package
_packages_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "packages"))
if _packages_path not in sys.path:
    sys.path.insert(0, _packages_path)

from pydantic import BaseModel

from mcp.server import Server
from mcp.tool import Tool
from mcp.prompt import Prompt
from mcp.argument import Argument
from mcp.resource import Resource
from mcp.response import Response


# ── test fixtures ────────────────────────────────────────────────────────────

class UpperTool(Tool):
    name = "upper"
    description = "Uppercases text."

    def schema(self):
        class Input(BaseModel):
            text: str
        return Input

    async def handle(self, arguments: dict) -> Response:
        return Response.text(arguments["text"].upper())


class HelloPrompt(Prompt):
    name = "hello"
    description = "Says hello."

    def arguments(self):
        return [Argument(name="name", description="Name to greet", required=True)]

    async def handle(self, arguments: dict) -> Response:
        return Response.text(f"Hello, {arguments.get('name', 'world')}!")


class InfoResource(Resource):
    uri = "test://info"
    name = "Info"
    description = "Returns info text."
    mime_type = "text/plain"

    async def read(self, **kwargs) -> str:
        path = kwargs.get("project_path", "unknown")
        return f"project={path}"


class IntegrationServer(Server):
    name = "integration-test"
    description = "Test server for integration tests."

    def tools(self):
        return [UpperTool]

    def prompts(self):
        return [HelloPrompt]

    def resources(self):
        return [InfoResource]


def _build_app() -> FastAPI:
    """Create a minimal FastAPI app with the MCP router mounted."""
    app = FastAPI()
    mcp = IntegrationServer()
    app.include_router(mcp.router("/mcp"))
    return app


_app = _build_app()


# ── tests ────────────────────────────────────────────────────────────────────

class TestMcpIntegration(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        transport = ASGITransport(app=_app)
        self.client = AsyncClient(transport=transport, base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()

    def _rpc(self, method: str, params: dict = None, rpc_id: int = 1) -> dict:
        body = {"jsonrpc": "2.0", "method": method, "id": rpc_id}
        if params:
            body["params"] = params
        return body

    async def test_initialize(self):
        resp = await self.client.post("/mcp", json=self._rpc("initialize"))
        self.assertEqual(resp.status_code, 200)
        result = resp.json()["result"]
        self.assertEqual(result["protocolVersion"], "2024-11-05")
        self.assertEqual(result["serverInfo"]["name"], "integration-test")
        self.assertIn("tools", result["capabilities"])
        self.assertIn("prompts", result["capabilities"])
        self.assertIn("resources", result["capabilities"])

    async def test_get_returns_405(self):
        resp = await self.client.get("/mcp")
        self.assertEqual(resp.status_code, 405)
        self.assertEqual(resp.headers["allow"], "POST")

    async def test_notification_returns_202(self):
        body = {"jsonrpc": "2.0", "method": "notifications/initialized"}
        resp = await self.client.post("/mcp", json=body)
        self.assertEqual(resp.status_code, 202)

    async def test_parse_error(self):
        resp = await self.client.post(
            "/mcp",
            content="not json",
            headers={"content-type": "application/json"},
        )
        # FastAPI body validation rejects malformed input before dispatch.
        self.assertEqual(resp.status_code, 422)
        self.assertIn("detail", resp.json())

    async def test_unknown_method(self):
        resp = await self.client.post("/mcp", json=self._rpc("foo/bar"))
        data = resp.json()
        self.assertIn("error", data)
        self.assertEqual(data["error"]["code"], -32601)

    async def test_tools_list(self):
        resp = await self.client.post("/mcp", json=self._rpc("tools/list"))
        tools = resp.json()["result"]["tools"]
        self.assertEqual(len(tools), 1)
        self.assertEqual(tools[0]["name"], "upper")

    async def test_tools_call(self):
        resp = await self.client.post("/mcp", json=self._rpc("tools/call", {
            "name": "upper",
            "arguments": {"text": "hello"},
        }))
        content = resp.json()["result"]["content"]
        self.assertEqual(content[0]["text"], "HELLO")

    async def test_tools_call_unknown(self):
        resp = await self.client.post("/mcp", json=self._rpc("tools/call", {
            "name": "nonexistent",
        }))
        data = resp.json()
        self.assertIn("error", data)

    async def test_prompts_list(self):
        resp = await self.client.post("/mcp", json=self._rpc("prompts/list"))
        prompts = resp.json()["result"]["prompts"]
        self.assertEqual(len(prompts), 1)
        self.assertEqual(prompts[0]["name"], "hello")

    async def test_prompts_get(self):
        resp = await self.client.post("/mcp", json=self._rpc("prompts/get", {
            "name": "hello",
            "arguments": {"name": "Alice"},
        }))
        messages = resp.json()["result"]["messages"]
        self.assertEqual(messages[0]["content"][0]["text"], "Hello, Alice!")

    async def test_resources_list(self):
        resp = await self.client.post("/mcp", json=self._rpc("resources/list"))
        resources = resp.json()["result"]["resources"]
        self.assertEqual(len(resources), 1)
        self.assertEqual(resources[0]["uri"], "test://info")

    async def test_resources_read(self):
        resp = await self.client.post(
            "/mcp",
            json=self._rpc("resources/read", {"uri": "test://info"}),
        )
        contents = resp.json()["result"]["contents"]
        self.assertEqual(contents[0]["text"], "project=unknown")
        self.assertEqual(contents[0]["uri"], "test://info")

    async def test_resources_read_unknown(self):
        resp = await self.client.post("/mcp", json=self._rpc("resources/read", {
            "uri": "test://nope",
        }))
        data = resp.json()
        self.assertIn("error", data)
