import json
import os
import tempfile
import unittest

from app.utils.hook_setup import ensure_mcp_json


class TestMcpJsonWriter(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = self._tmp.name
        self.mcp_path = os.path.join(self.dir, ".mcp.json")

    def tearDown(self):
        self._tmp.cleanup()

    def _read(self) -> dict:
        with open(self.mcp_path) as f:
            return json.load(f)

    def test_creates_file_with_keera_entry(self):
        changed = ensure_mcp_json(self.dir, "http://host:4545")
        self.assertTrue(changed)
        entry = self._read()["mcpServers"]["keera-agent-mcp"]
        self.assertEqual(entry["type"], "http")
        self.assertEqual(entry["url"], "http://host:4545/mcp")
        self.assertEqual(entry["headers"]["X-Project-Path"], self.dir)

    def test_project_path_overrides_directory_in_header(self):
        ensure_mcp_json(self.dir, "http://host:4545", project_path="/projects/foo")
        entry = self._read()["mcpServers"]["keera-agent-mcp"]
        self.assertEqual(entry["headers"]["X-Project-Path"], "/projects/foo")

    def test_preserves_other_mcp_servers(self):
        os.makedirs(self.dir, exist_ok=True)
        with open(self.mcp_path, "w") as f:
            json.dump({"mcpServers": {"other": {"type": "stdio", "command": "x"}}}, f)
        ensure_mcp_json(self.dir, "http://host:4545")
        servers = self._read()["mcpServers"]
        self.assertEqual(servers["other"], {"type": "stdio", "command": "x"})
        self.assertIn("keera-agent-mcp", servers)

    def test_url_re_syncs_when_base_url_changes(self):
        ensure_mcp_json(self.dir, "http://old:4545")
        changed = ensure_mcp_json(self.dir, "http://new:9999")
        self.assertTrue(changed)
        entry = self._read()["mcpServers"]["keera-agent-mcp"]
        self.assertEqual(entry["url"], "http://new:9999/mcp")

    def test_no_write_when_already_current(self):
        ensure_mcp_json(self.dir, "http://host:4545")
        self.assertFalse(ensure_mcp_json(self.dir, "http://host:4545"))

    def test_recovers_from_corrupt_json(self):
        os.makedirs(self.dir, exist_ok=True)
        with open(self.mcp_path, "w") as f:
            f.write("{ not json")
        changed = ensure_mcp_json(self.dir, "http://host:4545")
        self.assertTrue(changed)
        self.assertIn("keera-agent-mcp", self._read()["mcpServers"])


if __name__ == "__main__":
    unittest.main()
