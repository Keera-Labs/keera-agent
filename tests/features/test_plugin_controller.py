"""Feature tests for the plugin system API, run against the real app.

The bootstrapped app auto-discovers the Jira plugin, so these tests exercise
discovery, DB-backed activation state, live route mounting and the MCP
tools/list reflecting the active plugin — end to end.
"""

from unittest.mock import patch

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
