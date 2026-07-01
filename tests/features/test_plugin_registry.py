"""Unit tests for plugin discovery and the live-toggle registry."""

from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from app.plugins.base import Plugin
from app.plugins.loader import discover
from app.plugins.registry import PluginRegistry
from tests.test_case import TestCase


class _DummyPlugin(Plugin):
    slug = "dummy"
    name = "Dummy"
    description = "A dummy plugin."

    def routers(self):
        router = APIRouter()
        router.add_api_route("/dummy-ping", lambda: {"ok": True}, methods=["GET"])
        return [router]

    def tools(self):
        return ["tool-a", "tool-b"]


class TestPluginDiscovery(TestCase):
    async def test_discovers_jira_from_plugins_dir(self):
        plugins_dir = Path(__file__).resolve().parents[2] / "plugins"
        discovered = {p.slug: p for p in discover(plugins_dir)}

        self.assertIn("jira", discovered)
        self.assertEqual(discovered["jira"].name, "Jira")
        self.assertTrue(discovered["jira"].path.endswith("plugins/jira"))

    async def test_missing_directory_returns_empty(self):
        self.assertEqual(discover(Path("/no/such/dir")), [])


class TestPluginRegistry(TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.registry = PluginRegistry()
        self.registry.bind_app(self.app)
        self.registry.register(_DummyPlugin())

    async def test_activation_mounts_routes_and_exposes_tools(self):
        client = TestClient(self.app)
        self.assertEqual(client.get("/dummy-ping").status_code, 404)
        self.assertEqual(self.registry.active_tool_classes(), [])

        self.registry.activate("dummy")

        self.assertTrue(self.registry.is_active("dummy"))
        self.assertEqual(client.get("/dummy-ping").json(), {"ok": True})
        self.assertEqual(self.registry.active_tool_classes(), ["tool-a", "tool-b"])

    async def test_deactivation_unmounts_routes_and_hides_tools(self):
        self.registry.activate("dummy")
        self.registry.deactivate("dummy")

        client = TestClient(self.app)
        self.assertFalse(self.registry.is_active("dummy"))
        self.assertEqual(client.get("/dummy-ping").status_code, 404)
        self.assertEqual(self.registry.active_tool_classes(), [])

    async def test_activate_unknown_slug_is_noop(self):
        self.registry.activate("ghost")
        self.assertFalse(self.registry.is_active("ghost"))
