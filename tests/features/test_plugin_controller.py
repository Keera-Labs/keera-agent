"""Feature tests for the plugin system API, run against the real app.

The bootstrapped app auto-discovers the Jira plugin, so these tests exercise
discovery, DB-backed activation state, live route mounting and the MCP
tools/list reflecting the active plugin — end to end.
"""

from unittest.mock import AsyncMock, patch

from fastapi_startkit.application import app as container

from plugins.jira.config import JiraConfig
from tests.test_case import TestCase


class TestPluginController(TestCase):
    async def asyncTearDown(self):
        # Leave the shared registry / plugins table in a clean, inactive state.
        await self.post("/api/plugins/jira/deactivate")
        await super().asyncTearDown()

    def _registry(self):
        return container().make("plugins")

    async def _plugin_names_in_tools_list(self) -> set[str]:
        response = await self.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        tools = response.json()["result"]["tools"]
        return {t["name"] for t in tools}

    async def test_index_lists_discovered_jira_plugin(self):
        response = await self.get("/api/plugins")
        response.assert_ok()
        plugins = {p["slug"]: p for p in response.json()["data"]}
        self.assertIn("jira", plugins)
        self.assertEqual(plugins["jira"]["name"], "Jira")

    async def test_activate_mounts_routes_and_tools(self):
        response = await self.post("/api/plugins/jira/activate")
        response.assert_ok()
        self.assertTrue(response.json()["data"]["active"])
        self.assertTrue(self._registry().is_active("jira"))

        # MCP tools/list now advertises the Jira tools.
        self.assertIn("jira_search", await self._plugin_names_in_tools_list())

        # The Jira route is mounted; force an unconfigured client so the request
        # never hits live Jira and deterministically yields a clean 400.
        with patch("plugins.jira.client.jira_config", return_value=JiraConfig("", "", "")):
            search = await self.post("/api/plugins/jira/search", json={"jql": "project = ENG"})
        search.assert_status(400)

    async def test_deactivate_unmounts_routes_and_tools(self):
        await self.post("/api/plugins/jira/activate")
        response = await self.post("/api/plugins/jira/deactivate")
        response.assert_ok()
        self.assertFalse(response.json()["data"]["active"])
        self.assertFalse(self._registry().is_active("jira"))

        self.assertNotIn("jira_search", await self._plugin_names_in_tools_list())

        # Route is gone once the plugin is deactivated.
        search = await self.post("/api/plugins/jira/search", json={"jql": "project = ENG"})
        search.assert_status(404)

    async def test_activation_persists_in_database(self):
        await self.post("/api/plugins/jira/activate")

        from app.models.Plugin import Plugin as PluginModel
        row = await PluginModel.where("slug", "jira").first()
        self.assertIsNotNone(row)
        self.assertTrue(row.active)

    async def test_activate_unknown_plugin_returns_404(self):
        response = await self.post("/api/plugins/ghost/activate")
        response.assert_status(404)

    async def test_toggle_fires_lifecycle_hooks(self):
        plugin = self._registry().get("jira")
        with patch.object(type(plugin), "activate", new=AsyncMock()) as on_activate, \
                patch.object(type(plugin), "deactivate", new=AsyncMock()) as on_deactivate:
            await self.post("/api/plugins/jira/activate")
            on_activate.assert_awaited_once()
            on_deactivate.assert_not_awaited()

            await self.post("/api/plugins/jira/deactivate")
            on_deactivate.assert_awaited_once()

    async def test_redundant_toggle_is_noop_and_skips_hooks(self):
        plugin = self._registry().get("jira")

        await self.post("/api/plugins/jira/activate")
        with patch.object(type(plugin), "activate", new=AsyncMock()) as on_activate:
            response = await self.post("/api/plugins/jira/activate")
            response.assert_ok()
            self.assertTrue(response.json()["data"]["active"])
            on_activate.assert_not_awaited()
        self.assertTrue(self._registry().is_active("jira"))

        await self.post("/api/plugins/jira/deactivate")
        with patch.object(type(plugin), "deactivate", new=AsyncMock()) as on_deactivate:
            response = await self.post("/api/plugins/jira/deactivate")
            response.assert_ok()
            self.assertFalse(response.json()["data"]["active"])
            on_deactivate.assert_not_awaited()
        self.assertFalse(self._registry().is_active("jira"))

    async def test_activate_hook_failure_leaves_plugin_inactive(self):
        from app.models.Plugin import Plugin as PluginModel

        plugin = self._registry().get("jira")

        async def boom(self):
            raise RuntimeError("setup failed")

        with patch.object(type(plugin), "activate", new=boom):
            response = await self.post("/api/plugins/jira/activate")

        response.assert_status(500)
        self.assertFalse(self._registry().is_active("jira"))
        self.assertNotIn("jira_search", await self._plugin_names_in_tools_list())

        row = await PluginModel.where("slug", "jira").first()
        self.assertFalse(bool(row.active) if row is not None else False)

    async def test_uninstall_fires_hook_deactivates_and_removes_row(self):
        from app.models.Plugin import Plugin as PluginModel

        await self.post("/api/plugins/jira/activate")
        plugin = self._registry().get("jira")
        with patch.object(type(plugin), "uninstall", new=AsyncMock()) as on_uninstall:
            response = await self.post("/api/plugins/jira/uninstall")
            response.assert_ok()
            on_uninstall.assert_awaited_once()

        self.assertFalse(self._registry().is_active("jira"))
        self.assertNotIn("jira_search", await self._plugin_names_in_tools_list())
        self.assertIsNone(await PluginModel.where("slug", "jira").first())

    async def test_uninstall_unknown_plugin_returns_404(self):
        response = await self.post("/api/plugins/ghost/uninstall")
        response.assert_status(404)

    async def test_boot_sync_does_not_fire_activate_hook(self):
        from app.models.Plugin import Plugin as PluginModel
        from app.plugins.loader import sync_active

        registry = self._registry()
        row = await PluginModel.where("slug", "jira").first()
        if row is None:
            row = await PluginModel.create({"slug": "jira", "name": "Jira", "active": True})
        else:
            await row.update({"active": True})

        plugin = registry.get("jira")
        with patch.object(type(plugin), "activate", new=AsyncMock()) as on_activate:
            await sync_active(registry)
            on_activate.assert_not_awaited()

        self.assertTrue(registry.is_active("jira"))
