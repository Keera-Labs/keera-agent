import json
import os
import tempfile

from fastapi_startkit import Config

from app.actions.claude_hook_action import ClaudeHookAction
from tests.test_case import TestCase

BASE = "http://example.test:4545"


class TestClaudeHookAction(TestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._original_url = Config.get("fastapi.app_url")
        Config.set("fastapi.app_url", BASE)
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = self._tmp.name
        self.settings_path = os.path.join(self.dir, ".claude", "settings.json")

    async def asyncTearDown(self):
        Config.set("fastapi.app_url", self._original_url)
        self._tmp.cleanup()
        await super().asyncTearDown()

    def _read(self) -> dict:
        with open(self.settings_path) as f:
            return json.load(f)

    def _stop_hooks(self, settings: dict) -> list:
        return [h for group in settings["hooks"]["Stop"] for h in group.get("hooks", [])]

    async def test_writes_stop_hook_url_from_config(self):
        self.assertTrue(ClaudeHookAction.prepare(self.dir).execute())
        urls = [h["url"] for h in self._stop_hooks(self._read())]
        self.assertIn(f"{BASE}/api/claude-stopped", urls)

    async def test_preserves_other_keys(self):
        os.makedirs(os.path.dirname(self.settings_path))
        with open(self.settings_path, "w") as f:
            json.dump({"permissions": {"allow": ["Bash"]}, "custom": 7}, f)

        ClaudeHookAction.prepare(self.dir).execute()

        settings = self._read()
        self.assertEqual(settings["permissions"], {"allow": ["Bash"]})
        self.assertEqual(settings["custom"], 7)
        self.assertIn(f"{BASE}/api/claude-stopped", [h["url"] for h in self._stop_hooks(settings)])

    async def test_idempotent_second_call_is_noop(self):
        self.assertTrue(ClaudeHookAction.prepare(self.dir).execute())
        self.assertFalse(ClaudeHookAction.prepare(self.dir).execute())

    async def test_updates_stale_hook_url_in_place(self):
        Config.set("fastapi.app_url", "http://old:1111")
        ClaudeHookAction.prepare(self.dir).execute()

        Config.set("fastapi.app_url", BASE)
        self.assertTrue(ClaudeHookAction.prepare(self.dir).execute())

        urls = [h["url"] for h in self._stop_hooks(self._read())]
        self.assertIn(f"{BASE}/api/claude-stopped", urls)
        self.assertNotIn("http://old:1111/api/claude-stopped", urls)

    async def test_does_not_write_mcp_servers(self):
        ClaudeHookAction.prepare(self.dir).execute()
        self.assertNotIn("mcpServers", self._read())

    async def test_preserves_unrelated_stop_hooks(self):
        os.makedirs(os.path.dirname(self.settings_path))
        with open(self.settings_path, "w") as f:
            json.dump(
                {"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "echo hi"}]}]}}, f
            )

        ClaudeHookAction.prepare(self.dir).execute()

        stop = self._stop_hooks(self._read())
        self.assertIn("echo hi", [h.get("command") for h in stop])
        self.assertIn(f"{BASE}/api/claude-stopped", [h.get("url") for h in stop])
