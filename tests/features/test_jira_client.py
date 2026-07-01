"""Unit tests for the Jira plugin's client, config and tool wiring."""

import json
from unittest.mock import patch

import httpx

from plugins.jira.client import JiraClient, JiraConfigError, _text_to_adf
from plugins.jira.config import JiraConfig, jira_config
from plugins.jira.provider import JiraPlugin
from plugins.jira.tools import JIRA_TOOLS, JiraSearchTool
from tests.test_case import TestCase


def _mock_client(handler) -> JiraClient:
    """A JiraClient whose outbound requests are served by a MockTransport."""
    return JiraClient(
        "https://x.atlassian.net", "a@b.c", "tok",
        transport=httpx.MockTransport(handler),
    )


class TestJiraConfig(TestCase):
    async def test_is_configured_requires_all_fields(self):
        self.assertFalse(JiraConfig("", "", "").is_configured)
        self.assertFalse(JiraConfig("https://x.atlassian.net", "a@b.c", "").is_configured)
        self.assertTrue(JiraConfig("https://x.atlassian.net", "a@b.c", "tok").is_configured)

    async def test_reads_env_var_names_matching_dot_env(self):
        # Locks the contract: .env defines JIRA_BASE_URL / JIRA_USERNAME / JIRA_TOKEN.
        fake = {
            "JIRA_BASE_URL": "https://x.atlassian.net/",
            "JIRA_USERNAME": "u@e.com",
            "JIRA_TOKEN": "tok",
        }
        with patch("plugins.jira.config.env", lambda key, default="": fake.get(key, default)):
            cfg = jira_config()
        self.assertEqual(cfg.base_url, "https://x.atlassian.net")
        self.assertEqual(cfg.username, "u@e.com")
        self.assertEqual(cfg.api_token, "tok")
        self.assertTrue(cfg.is_configured)


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


class TestJiraClientRequests(TestCase):
    """Mocked-transport tests asserting the real outbound request shape."""

    async def test_search_posts_to_search_jql_with_body(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["method"] = request.method
            seen["path"] = request.url.path
            seen["body"] = json.loads(request.content)
            return httpx.Response(200, json={"issues": [{"key": "ENG-1"}], "nextPageToken": "next-2"})

        client = _mock_client(handler)
        data = await client.search("project = ENG", max_results=10, fields=["summary"], next_page_token="tok-1")

        self.assertEqual(seen["method"], "POST")
        self.assertEqual(seen["path"], "/rest/api/3/search/jql")
        self.assertEqual(seen["body"], {
            "jql": "project = ENG",
            "maxResults": 10,
            "fields": ["summary"],
            "nextPageToken": "tok-1",
        })
        # Response is parsed and token-based pagination surfaced verbatim.
        self.assertEqual(data["issues"][0]["key"], "ENG-1")
        self.assertEqual(data["nextPageToken"], "next-2")

    async def test_search_omits_optional_fields_when_absent(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["body"] = json.loads(request.content)
            return httpx.Response(200, json={"issues": []})

        await _mock_client(handler).search("project = ENG")

        self.assertEqual(seen["body"], {"jql": "project = ENG", "maxResults": 50})
        self.assertNotIn("fields", seen["body"])
        self.assertNotIn("nextPageToken", seen["body"])

    async def test_update_issue_puts_fields_wrapper(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["method"] = request.method
            seen["path"] = request.url.path
            seen["body"] = json.loads(request.content)
            return httpx.Response(204)

        result = await _mock_client(handler).update_issue("ENG-1", {"summary": "New title"})

        self.assertEqual(seen["method"], "PUT")
        self.assertEqual(seen["path"], "/rest/api/3/issue/ENG-1")
        self.assertEqual(seen["body"], {"fields": {"summary": "New title"}})
        self.assertEqual(result, {"issue": "ENG-1", "updated": True})

    async def test_add_worklog_posts_adf_comment(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["method"] = request.method
            seen["path"] = request.url.path
            seen["body"] = json.loads(request.content)
            return httpx.Response(201, json={"id": "10001"})

        result = await _mock_client(handler).add_worklog(
            "ENG-1", "1h 30m", comment="Investigated", started="2026-06-30T09:00:00.000+0000",
        )

        self.assertEqual(seen["method"], "POST")
        self.assertEqual(seen["path"], "/rest/api/3/issue/ENG-1/worklog")
        self.assertEqual(seen["body"]["timeSpent"], "1h 30m")
        self.assertEqual(seen["body"]["started"], "2026-06-30T09:00:00.000+0000")
        # Comment is ADF-wrapped, not a bare string.
        self.assertEqual(seen["body"]["comment"]["type"], "doc")
        self.assertEqual(
            seen["body"]["comment"]["content"][0]["content"][0]["text"], "Investigated",
        )
        self.assertEqual(result, {"id": "10001"})

    async def test_add_worklog_omits_optional_fields(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["body"] = json.loads(request.content)
            return httpx.Response(201, json={"id": "1"})

        await _mock_client(handler).add_worklog("ENG-1", "15m")

        self.assertEqual(seen["body"], {"timeSpent": "15m"})

    async def test_raise_for_status_propagates(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(410, text="Gone")

        with self.assertRaises(httpx.HTTPStatusError):
            await _mock_client(handler).search("project = ENG")


class TestJiraPlugin(TestCase):
    async def test_plugin_exposes_router_and_tools(self):
        plugin = JiraPlugin()
        self.assertEqual(plugin.slug, "jira")
        self.assertEqual(len(plugin.routers()), 1)
        self.assertEqual(plugin.tools(), JIRA_TOOLS)

    async def test_search_tool_reports_missing_config(self):
        # Force an unconfigured state so the test is deterministic regardless of
        # any JIRA_* values present in the ambient environment.
        with patch("plugins.jira.client.jira_config", return_value=JiraConfig("", "", "")):
            text = (await JiraSearchTool().handle({"jql": "project = ENG"})).to_content()[0]["text"]
        self.assertIn("Jira is not configured", text)
