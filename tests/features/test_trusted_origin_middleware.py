import json
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from fastapi_startkit import Config
from starlette.applications import Starlette
from starlette.routing import WebSocketRoute
from starlette.testclient import TestClient
from starlette.websockets import WebSocket, WebSocketDisconnect

from app.middleware.trusted_origin_middleware import TrustedOriginMiddleware, TrustedOrigins
from tests.test_case import TestCase

FOREIGN_ORIGIN = "https://evil.example"
MCP_INITIALIZE = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}


async def echo(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_text("connected")
    await websocket.close()


def websocket_client(app_url: str, vite_hot_file: Path | None = None) -> TestClient:
    app = Starlette(routes=[WebSocketRoute("/ws", echo)])
    app.add_middleware(TrustedOriginMiddleware, trusted=TrustedOrigins(app_url, vite_hot_file))
    return TestClient(app, base_url=app_url)


class TestTrustedOriginMiddleware(TestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.app_url = Config.get("fastapi.app_url").rstrip("/")
        self.port = urlsplit(self.app_url).port
        self.ws_url = f"ws://{urlsplit(self.app_url).netloc}"

    async def test_foreign_origin_post_is_rejected(self):
        response = await self.post(
            "/api/claude-stopped", json={}, headers={"Origin": FOREIGN_ORIGIN}
        )

        response.assert_status(403)
        self.assertEqual(response.json()["error"], "Request origin is not trusted.")

    async def test_null_origin_post_is_rejected(self):
        response = await self.post("/api/claude-stopped", json={}, headers={"Origin": "null"})

        response.assert_status(403)

    async def test_foreign_origin_delete_is_rejected(self):
        response = await self.delete("/api/tasks/1", headers={"Origin": FOREIGN_ORIGIN})

        response.assert_status(403)

    async def test_app_origin_post_is_allowed(self):
        response = await self.post("/api/claude-stopped", json={}, headers={"Origin": self.app_url})

        response.assert_ok()

    async def test_loopback_origin_on_app_port_is_allowed(self):
        for hostname in ("localhost", "127.0.0.1", "[::1]"):
            origin = f"http://{hostname}:{self.port}"
            response = await self.post("/api/claude-stopped", json={}, headers={"Origin": origin})

            response.assert_ok()

    async def test_loopback_origin_on_another_port_is_rejected(self):
        response = await self.post(
            "/api/claude-stopped", json={}, headers={"Origin": f"http://127.0.0.1:{self.port + 1}"}
        )

        response.assert_status(403)

    async def test_hook_post_without_origin_is_allowed(self):
        response = await self.post(
            "/api/agent-hook-events", json={"hook_event_name": "PostToolUse"}
        )

        self.assertNotIn(response.status_code, (403, 415))

    async def test_mcp_post_without_origin_is_allowed(self):
        response = await self.post("/mcp", json=MCP_INITIALIZE)

        response.assert_ok()
        self.assertIn("result", response.json())

    async def test_body_without_content_type_and_origin_is_rejected(self):
        response = await self.post("/mcp", content=json.dumps(MCP_INITIALIZE))

        response.assert_status(415)
        self.assertEqual(
            response.json()["error"], "Requests without an Origin header must send a JSON body."
        )

    async def test_text_plain_body_without_origin_is_rejected(self):
        response = await self.post(
            "/api/claude-stopped", content="{}", headers={"Content-Type": "text/plain"}
        )

        response.assert_status(415)

    async def test_bodyless_post_without_origin_is_allowed(self):
        response = await self.post("/api/claude-started")

        self.assertNotIn(response.status_code, (403, 415))

    async def test_foreign_origin_get_is_allowed(self):
        response = await self.get("/api/projects/0/tasks", headers={"Origin": FOREIGN_ORIGIN})

        self.assertNotEqual(response.status_code, 403)

    async def test_foreign_host_get_is_rejected(self):
        response = await self.get(
            "/api/projects/0/tasks", headers={"Host": f"evil.example:{self.port}"}
        )

        response.assert_status(403)
        self.assertEqual(response.json()["error"], "Request host is not trusted.")

    async def test_rebound_host_post_is_rejected_even_with_matching_origin(self):
        rebound = f"evil.example:{self.port}"
        response = await self.post(
            "/api/claude-stopped", json={}, headers={"Host": rebound, "Origin": f"http://{rebound}"}
        )

        response.assert_status(403)

    async def test_foreign_origin_terminal_websocket_is_rejected(self):
        client = TestClient(self.get_application().fastapi, base_url=self.app_url)

        with self.assertRaises(WebSocketDisconnect) as raised:
            with client.websocket_connect(
                f"{self.ws_url}/some-project/ws", headers={"Origin": FOREIGN_ORIGIN}
            ):
                pass

        self.assertEqual(raised.exception.code, 1008)

    async def test_foreign_host_websocket_is_rejected(self):
        client = websocket_client(self.app_url)

        with self.assertRaises(WebSocketDisconnect):
            with client.websocket_connect(
                f"{self.ws_url}/ws", headers={"Host": f"evil.example:{self.port}"}
            ):
                pass

    async def test_app_origin_websocket_is_allowed(self):
        client = websocket_client(self.app_url)

        with client.websocket_connect(
            f"{self.ws_url}/ws", headers={"Origin": self.app_url}
        ) as websocket:
            self.assertEqual(websocket.receive_text(), "connected")

    async def test_websocket_without_origin_is_allowed(self):
        client = websocket_client(self.app_url)

        with client.websocket_connect(f"{self.ws_url}/ws") as websocket:
            self.assertEqual(websocket.receive_text(), "connected")

    async def test_vite_dev_server_origin_is_allowed_while_hot(self):
        with tempfile.TemporaryDirectory() as directory:
            hot_file = Path(directory, "hot")
            hot_file.write_text("http://[::1]:5173\n")
            client = websocket_client(self.app_url, vite_hot_file=hot_file)

            with client.websocket_connect(
                f"{self.ws_url}/ws", headers={"Origin": "http://[::1]:5173"}
            ) as websocket:
                self.assertEqual(websocket.receive_text(), "connected")

            hot_file.unlink()
            with self.assertRaises(WebSocketDisconnect):
                with client.websocket_connect(
                    f"{self.ws_url}/ws", headers={"Origin": "http://[::1]:5173"}
                ):
                    pass
