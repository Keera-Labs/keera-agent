import json
import shlex
import sys
import tempfile
from pathlib import Path

from fastapi_startkit import Config

from app.actions.statusline_settings_write_action import (
    STATUSLINE_SCRIPT,
    StatuslineSettingsWriteAction,
)
from app.ai import ProviderCommand, providers
from tests.test_case import TestCase


class TestStatuslineSettingsWriteAction(TestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._original_url = Config.get("fastapi.app_url")
        Config.set("fastapi.app_url", "http://example.test:4545")
        self._tmp = tempfile.TemporaryDirectory()
        self.path = Path(self._tmp.name) / "claude" / "statusline-settings.json"

    async def asyncTearDown(self):
        Config.set("fastapi.app_url", self._original_url)
        self._tmp.cleanup()
        await super().asyncTearDown()

    async def test_writes_a_statusline_that_reports_to_the_app(self):
        self.assertTrue(StatuslineSettingsWriteAction(self.path).execute())

        status_line = json.loads(self.path.read_text())["statusLine"]
        self.assertEqual(status_line["type"], "command")
        self.assertEqual(
            shlex.split(status_line["command"]),
            [
                sys.executable,
                str(STATUSLINE_SCRIPT),
                "http://example.test:4545/api/agent-usage-reports",
            ],
        )

    async def test_is_idempotent_and_follows_the_app_url(self):
        StatuslineSettingsWriteAction(self.path).execute()
        self.assertFalse(StatuslineSettingsWriteAction(self.path).execute())

        Config.set("fastapi.app_url", "http://localhost:8000")
        self.assertTrue(StatuslineSettingsWriteAction(self.path).execute())
        self.assertIn("localhost:8000", self.path.read_text())

    async def test_claude_command_passes_the_settings_file(self):
        command = providers.get("claude").build_command(
            ProviderCommand(
                model="claude-sonnet-5",
                settings_file="/app/storage/claude/statusline settings.json",
            )
        )

        self.assertEqual(
            command,
            "claude --model claude-sonnet-5 --settings '/app/storage/claude/statusline settings.json'",
        )

    async def test_codex_ignores_the_settings_file(self):
        command = providers.get("codex").build_command(ProviderCommand(settings_file="/tmp/s.json"))

        self.assertNotIn("/tmp/s.json", command)
