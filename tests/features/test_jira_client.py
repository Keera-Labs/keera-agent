"""Unit tests for the Jira plugin's client, config and tool wiring."""

from plugins.jira.client import JiraClient, JiraConfigError, _text_to_adf
from plugins.jira.config import JiraConfig
from plugins.jira.provider import JiraPlugin
from plugins.jira.tools import JIRA_TOOLS, JiraSearchTool
from tests.test_case import TestCase


class TestJiraConfig(TestCase):
    async def test_is_configured_requires_all_fields(self):
        self.assertFalse(JiraConfig("", "", "").is_configured)
        self.assertFalse(JiraConfig("https://x.atlassian.net", "a@b.c", "").is_configured)
        self.assertTrue(JiraConfig("https://x.atlassian.net", "a@b.c", "tok").is_configured)


class TestJiraClient(TestCase):
    async def test_raises_when_unconfigured(self):
        with self.assertRaises(JiraConfigError):
            JiraClient("", "", "")
        with self.assertRaises(JiraConfigError):
            JiraClient.from_config(JiraConfig("", "", ""))

    async def test_builds_client_when_configured(self):
        client = JiraClient("https://x.atlassian.net/", "a@b.c", "tok")
        self.assertEqual(client._base_url, "https://x.atlassian.net")

    async def test_text_to_adf_shape(self):
        adf = _text_to_adf("hello")
        self.assertEqual(adf["type"], "doc")
        self.assertEqual(adf["content"][0]["content"][0]["text"], "hello")


class TestJiraPlugin(TestCase):
    async def test_plugin_exposes_router_and_tools(self):
        plugin = JiraPlugin()
        self.assertEqual(plugin.slug, "jira")
        self.assertEqual(len(plugin.routers()), 1)
        self.assertEqual(plugin.tools(), JIRA_TOOLS)

    async def test_search_tool_reports_missing_config(self):
        # In the testing environment JIRA_* is unset, so the tool must return a
        # readable error rather than raising.
        text = (await JiraSearchTool().handle({"jql": "project = ENG"})).to_content()[0]["text"]
        self.assertIn("Jira is not configured", text)
