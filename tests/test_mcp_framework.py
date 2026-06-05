import sys
import os
import unittest

from pydantic import BaseModel

# Add packages/ to sys.path so `mcp` is importable as a package
_packages_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "packages"))
if _packages_path not in sys.path:
    sys.path.insert(0, _packages_path)

from mcp.response import Response
from mcp.tool import Tool
from mcp.prompt import Prompt
from mcp.argument import Argument
from mcp.resource import Resource
from mcp.server import Server
from mcp.protocol import Protocol


# ── test fixtures ────────────────────────────────────────────────────────────

class EchoTool(Tool):
    name = "echo"
    description = "Echoes the input back."

    def schema(self):
        class Input(BaseModel):
            message: str
        return Input

    async def handle(self, arguments: dict) -> Response:
        return Response.text(arguments["message"])


class AddTool(Tool):
    name = "add"
    description = "Adds two numbers."

    def schema(self):
        class Input(BaseModel):
            a: float
            b: float
        return Input

    def output_schema(self):
        class Output(BaseModel):
            sum: float
        return Output

    async def handle(self, arguments: dict) -> Response:
        result = arguments["a"] + arguments["b"]
        return Response.text(str(result))


class GreetPrompt(Prompt):
    name = "greet"
    description = "Generates a greeting."

    def arguments(self):
        return [Argument(name="name", description="Who to greet", required=True)]

    async def handle(self, arguments: dict) -> Response:
        return Response.text(f"Hello, {arguments['name']}!")


class DisabledPrompt(Prompt):
    name = "disabled"
    description = "Should not be registered."

    def should_register(self):
        return False

    async def handle(self, arguments: dict) -> Response:
        return Response.text("nope")


class StatusResource(Resource):
    uri = "test://status"
    name = "Status"
    description = "Returns server status."
    mime_type = "text/plain"

    async def read(self, **kwargs) -> str:
        return "ok"


class TestServer(Server):
    name = "test-server"
    description = "A test server."
    instructions = "Use the echo tool."

    def tools(self):
        return [EchoTool, AddTool]

    def prompts(self):
        return [GreetPrompt, DisabledPrompt]

    def resources(self):
        return [StatusResource]


class EmptyServer(Server):
    name = "empty"


# ── tests ────────────────────────────────────────────────────────────────────

class TestResponse(unittest.IsolatedAsyncioTestCase):
    def test_text(self):
        r = Response.text("hi")
        self.assertEqual(r.to_content(), [{"type": "text", "text": "hi"}])

    def test_structure(self):
        data = {"uri": "test://x", "text": "content"}
        r = Response.structure(data)
        self.assertEqual(r.to_content(), [{"type": "resource", "resource": data}])

    def test_empty_response(self):
        r = Response()
        self.assertEqual(r.to_content(), [{"type": "text", "text": ""}])


class TestTool(unittest.IsolatedAsyncioTestCase):
    def test_to_json(self):
        tool = EchoTool()
        schema = tool.to_json()
        self.assertEqual(schema["name"], "echo")
        self.assertEqual(schema["description"], "Echoes the input back.")
        self.assertIn("properties", schema["inputSchema"])
        self.assertNotIn("outputSchema", schema)

    def test_to_json_with_output(self):
        tool = AddTool()
        schema = tool.to_json()
        self.assertIn("outputSchema", schema)
        self.assertEqual(schema["outputSchema"]["type"], "object")

    async def test_handle(self):
        tool = EchoTool()
        resp = await tool.handle({"message": "hello"})
        self.assertEqual(resp.to_content(), [{"type": "text", "text": "hello"}])


class TestPrompt(unittest.IsolatedAsyncioTestCase):
    def test_to_json(self):
        prompt = GreetPrompt()
        schema = prompt.to_json()
        self.assertEqual(schema["name"], "greet")
        self.assertEqual(len(schema["arguments"]), 1)
        self.assertEqual(schema["arguments"][0]["name"], "name")

    def test_should_register_default_true(self):
        self.assertTrue(GreetPrompt().should_register())

    def test_should_register_false(self):
        self.assertFalse(DisabledPrompt().should_register())

    async def test_handle(self):
        prompt = GreetPrompt()
        resp = await prompt.handle({"name": "World"})
        self.assertEqual(resp.to_content(), [{"type": "text", "text": "Hello, World!"}])


class TestResource(unittest.IsolatedAsyncioTestCase):
    def test_to_json(self):
        r = StatusResource()
        schema = r.to_json()
        self.assertEqual(schema["uri"], "test://status")
        self.assertEqual(schema["name"], "Status")
        self.assertEqual(schema["mimeType"], "text/plain")
        self.assertEqual(schema["description"], "Returns server status.")

    def test_to_json_no_description(self):
        class Bare(Resource):
            uri = "test://bare"
            name = "Bare"
            async def read(self, **kwargs):
                return ""
        schema = Bare().to_json()
        self.assertNotIn("description", schema)

    async def test_read(self):
        r = StatusResource()
        self.assertEqual(await r.read(), "ok")


class TestServer_(unittest.IsolatedAsyncioTestCase):
    def test_capabilities_with_components(self):
        s = TestServer()
        caps = s.capabilities()
        self.assertIn("tools", caps)
        self.assertIn("prompts", caps)
        self.assertIn("resources", caps)

    def test_capabilities_empty(self):
        s = EmptyServer()
        caps = s.capabilities()
        self.assertEqual(caps, {})

    def test_defaults(self):
        s = EmptyServer()
        self.assertIsNone(s.tools())
        self.assertIsNone(s.prompts())
        self.assertIsNone(s.resources())
        self.assertIsNone(s.schema())
        self.assertIsNone(s.middleware())


class TestProtocol(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        server = TestServer()
        tools = [cls() for cls in server.tools()]
        prompts = [cls() for cls in server.prompts() if cls().should_register()]
        resources = [cls() for cls in server.resources()]
        self.protocol = (
            Protocol(server).tools(tools).prompts(prompts).resources(resources)
        )

    async def test_initialize(self):
        result = await self.protocol.dispatch("initialize", 1, {})
        self.assertEqual(result["id"], 1)
        self.assertEqual(result["result"]["protocolVersion"], "2024-11-05")
        self.assertEqual(result["result"]["serverInfo"]["name"], "test-server")
        self.assertIn("tools", result["result"]["capabilities"])

    async def test_tools_list(self):
        result = await self.protocol.dispatch("tools/list", 2, {})
        tools = result["result"]["tools"]
        names = [t["name"] for t in tools]
        self.assertIn("echo", names)
        self.assertIn("add", names)
        self.assertEqual(len(tools), 2)

    async def test_tools_call(self):
        result = await self.protocol.dispatch("tools/call", 3, {
            "name": "echo",
            "arguments": {"message": "test"},
        })
        content = result["result"]["content"]
        self.assertEqual(content, [{"type": "text", "text": "test"}])

    async def test_tools_call_unknown(self):
        result = await self.protocol.dispatch("tools/call", 4, {"name": "nope"})
        self.assertIn("error", result)
        self.assertEqual(result["error"]["code"], -32601)

    async def test_tools_call_error_handling(self):
        class FailTool(Tool):
            name = "fail"
            description = "Always fails."
            def schema(self):
                return BaseModel
            async def handle(self, arguments):
                raise ValueError("boom")

        server = EmptyServer()
        protocol = Protocol(server).tools([FailTool()])
        result = await protocol.dispatch("tools/call", 5, {
            "name": "fail", "arguments": {},
        })
        content = result["result"]["content"]
        self.assertIn("Error: boom", content[0]["text"])

    async def test_prompts_list(self):
        result = await self.protocol.dispatch("prompts/list", 6, {})
        prompts = result["result"]["prompts"]
        names = [p["name"] for p in prompts]
        self.assertIn("greet", names)
        self.assertNotIn("disabled", names)

    async def test_prompts_get(self):
        result = await self.protocol.dispatch("prompts/get", 7, {
            "name": "greet",
            "arguments": {"name": "Alice"},
        })
        messages = result["result"]["messages"]
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["role"], "user")
        self.assertIn("Alice", messages[0]["content"][0]["text"])

    async def test_prompts_get_unknown(self):
        result = await self.protocol.dispatch("prompts/get", 8, {"name": "nope"})
        self.assertIn("error", result)

    async def test_resources_list(self):
        result = await self.protocol.dispatch("resources/list", 9, {})
        resources = result["result"]["resources"]
        self.assertEqual(len(resources), 1)
        self.assertEqual(resources[0]["uri"], "test://status")

    async def test_resources_read(self):
        result = await self.protocol.dispatch("resources/read", 10, {
            "uri": "test://status",
        })
        contents = result["result"]["contents"]
        self.assertEqual(contents[0]["text"], "ok")
        self.assertEqual(contents[0]["uri"], "test://status")

    async def test_resources_read_unknown(self):
        result = await self.protocol.dispatch("resources/read", 11, {
            "uri": "test://nope",
        })
        self.assertIn("error", result)
        self.assertEqual(result["error"]["code"], -32602)

    async def test_unknown_method(self):
        result = await self.protocol.dispatch("foo/bar", 12, {})
        self.assertIn("error", result)
        self.assertEqual(result["error"]["code"], -32601)

    async def test_ok_helper(self):
        r = Protocol.ok(1, {"key": "val"})
        self.assertEqual(r, {"jsonrpc": "2.0", "id": 1, "result": {"key": "val"}})

    async def test_err_helper(self):
        r = Protocol.err(1, -32600, "bad")
        self.assertEqual(r["error"]["code"], -32600)
        self.assertEqual(r["error"]["message"], "bad")
