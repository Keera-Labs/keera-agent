import json
import os
import tempfile
import unittest

from app.utils.hook_setup import ensure_claude_settings

BASE = "http://example.test:4545"


class TestHookSetupWriter(unittest.TestCase):
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
        changed = ensure_claude_settings(self.dir, BASE)
        self.assertTrue(changed)
        urls = [h["url"] for h in self._stop_hooks(self._read())]
        self.assertIn(f"{BASE}/api/claude-stopped", urls)

    def test_preserves_other_keys(self):
        os.makedirs(os.path.dirname(self.settings_path))
        with open(self.settings_path, "w") as f:
            json.dump({"permissions": {"allow": ["Bash"]}, "custom": 7}, f)

        ensure_claude_settings(self.dir, BASE)

        settings = self._read()
        self.assertEqual(settings["permissions"], {"allow": ["Bash"]})
        self.assertEqual(settings["custom"], 7)
        self.assertIn(f"{BASE}/api/claude-stopped", [h["url"] for h in self._stop_hooks(settings)])

    def test_idempotent_second_call_is_noop(self):
        self.assertTrue(ensure_claude_settings(self.dir, BASE))
        self.assertFalse(ensure_claude_settings(self.dir, BASE))

    def test_updates_stale_hook_url_in_place(self):
        ensure_claude_settings(self.dir, "http://old:1111")
        self.assertTrue(ensure_claude_settings(self.dir, BASE))

        stop = self._stop_hooks(self._read())
        urls = [h["url"] for h in stop]
        self.assertIn(f"{BASE}/api/claude-stopped", urls)
        self.assertNotIn("http://old:1111/api/claude-stopped", urls)


if __name__ == "__main__":
    unittest.main()
