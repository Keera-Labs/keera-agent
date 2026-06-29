import json
import os
import tempfile

from fastapi_startkit import Config
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.mcp_setting_write_action import McpSettingWriteAction
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestMcpSettingWriteAction(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = self._tmp.name
        self.mcp_path = os.path.join(self.dir, ".mcp.json")
        self.project = await ProjectFactory.new().create(path=self.dir)

    async def asyncTearDown(self):
        self._tmp.cleanup()
        await super().asyncTearDown()

    def _read(self) -> dict:
        with open(self.mcp_path) as f:
            return json.load(f)

    async def _run(self) -> bool:
        return await McpSettingWriteAction.prepare(self.project.id).execute()

    async def test_creates_entry_from_db_path_and_config_url(self):
        self.assertTrue(await self._run())
        entry = self._read()["mcpServers"]["keera-agent-mcp"]
        self.assertEqual(entry["type"], "http")
        self.assertEqual(entry["url"], f"{Config.get('fastapi.app_url')}/mcp")
        self.assertEqual(entry["headers"]["X-Project-Path"], self.dir)

    async def test_preserves_other_mcp_servers(self):
        with open(self.mcp_path, "w") as f:
            json.dump({"mcpServers": {"other": {"type": "stdio", "command": "x"}}}, f)
        await self._run()
        servers = self._read()["mcpServers"]
        self.assertEqual(servers["other"], {"type": "stdio", "command": "x"})
        self.assertIn("keera-agent-mcp", servers)

    async def test_no_write_when_already_current(self):
        await self._run()
        self.assertFalse(await self._run())

    async def test_url_re_syncs_when_app_url_changes(self):
        original = Config.get("fastapi.app_url")
        try:
            Config.set("fastapi.app_url", "http://old:4545")
            await self._run()
            Config.set("fastapi.app_url", "http://new:9999")
            self.assertTrue(await self._run())
            entry = self._read()["mcpServers"]["keera-agent-mcp"]
            self.assertEqual(entry["url"], "http://new:9999/mcp")
        finally:
            Config.set("fastapi.app_url", original)

    async def test_recovers_from_corrupt_json(self):
        with open(self.mcp_path, "w") as f:
            f.write("{ not json")
        self.assertTrue(await self._run())
        self.assertIn("keera-agent-mcp", self._read()["mcpServers"])

    async def test_missing_directory_is_noop(self):
        project = await ProjectFactory.new().create(path="/no/such/dir/keera-xyz")
        self.assertFalse(await McpSettingWriteAction.prepare(project.id).execute())

    async def test_unknown_project_is_noop(self):
        self.assertFalse(await McpSettingWriteAction.prepare(999999).execute())
