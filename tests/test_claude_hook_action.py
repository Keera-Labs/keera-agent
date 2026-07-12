import json
import os
import tempfile
import unittest

from app.actions.claude_hook_action import ClaudeHookAction

BASE = "http://example.test:4545"


class TestClaudeHookAction(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = self._tmp.name
        self.settings_path = os.path.join(self.dir, ".claude", "settings.json")

    def tearDown(self):
        self._tmp.cleanup()

    def _read(self) -> dict:
        with open(self.settings_path) as f:
            return json.load(f)

    def _stop_hooks(self, settings: dict) -> list:
        return [h for group in settings["hooks"]["Stop"] for h in group.get("hooks", [])]

    def test_writes_stop_hook_url_from_base_url(self):
        changed = ClaudeHookAction.prepare(self.dir, base_url=BASE).execute()
        self.assertTrue(changed)
        urls = [h["url"] for h in self._stop_hooks(self._read())]
        self.assertIn(f"{BASE}/api/claude-stopped", urls)

    def test_defaults_base_url_from_env(self):
        from app.utils.hook_setup import BASE_URL

        ClaudeHookAction.prepare(self.dir).execute()
        urls = [h["url"] for h in self._stop_hooks(self._read())]
        self.assertIn(f"{BASE_URL}/api/claude-stopped", urls)

    def test_preserves_other_keys(self):
        os.makedirs(os.path.dirname(self.settings_path))
        with open(self.settings_path, "w") as f:
            json.dump({"permissions": {"allow": ["Bash"]}, "custom": 7}, f)

        ClaudeHookAction.prepare(self.dir, base_url=BASE).execute()

        settings = self._read()
        self.assertEqual(settings["permissions"], {"allow": ["Bash"]})
        self.assertEqual(settings["custom"], 7)
        self.assertIn(f"{BASE}/api/claude-stopped", [h["url"] for h in self._stop_hooks(settings)])

    def test_idempotent_second_call_is_noop(self):
        self.assertTrue(ClaudeHookAction.prepare(self.dir, base_url=BASE).execute())
        self.assertFalse(ClaudeHookAction.prepare(self.dir, base_url=BASE).execute())

    def test_updates_stale_hook_url_in_place(self):
        ClaudeHookAction.prepare(self.dir, base_url="http://old:1111").execute()
        self.assertTrue(ClaudeHookAction.prepare(self.dir, base_url=BASE).execute())

        urls = [h["url"] for h in self._stop_hooks(self._read())]
        self.assertIn(f"{BASE}/api/claude-stopped", urls)
        self.assertNotIn("http://old:1111/api/claude-stopped", urls)

    def test_mcp_entry_uses_project_path_override(self):
        ClaudeHookAction.prepare(self.dir, base_url=BASE, project_path="/proj/root").execute()
        entry = self._read()["mcpServers"]["keera-agent"]
        self.assertEqual(entry["url"], f"{BASE}/mcp")
        self.assertEqual(entry["headers"]["X-Project-Path"], "/proj/root")


if __name__ == "__main__":
    unittest.main()
