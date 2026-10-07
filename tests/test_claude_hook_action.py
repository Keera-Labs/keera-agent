import json
import os
import tempfile

from fastapi_startkit import Config

from app.actions.claude_hook_action import (
    AGENT_ID_ENV,
    AGENT_ID_HEADER,
    ClaudeHookAction,
    agent_env,
)
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

    def _groups_for(self, settings: dict, event: str, path: str) -> list:
        return [
            group
            for group in settings["hooks"][event]
            if any(h.get("url") == f"{BASE}{path}" for h in group.get("hooks", []))
        ]

    async def test_writes_agent_status_hooks_with_matchers(self):
        ClaudeHookAction.prepare(self.dir).execute()
        settings = self._read()

        expected = {
            "PreToolUse": "AskUserQuestion",
            "Notification": "permission_prompt|elicitation_dialog",
            "PostToolUse": None,
            "UserPromptSubmit": None,
        }
        for event, matcher in expected.items():
            groups = self._groups_for(settings, event, "/api/agent-hook-events")
            self.assertEqual(len(groups), 1, event)
            self.assertEqual(groups[0].get("matcher"), matcher, event)

    async def test_attributed_hooks_send_agent_id_header_from_env(self):
        ClaudeHookAction.prepare(self.dir).execute()
        settings = self._read()

        stop = self._groups_for(settings, "Stop", "/api/claude-stopped")[0]["hooks"][0]
        self.assertEqual(stop["headers"], {AGENT_ID_HEADER: f"${AGENT_ID_ENV}"})
        self.assertEqual(stop["allowedEnvVars"], [AGENT_ID_ENV])
        started = self._groups_for(settings, "UserPromptSubmit", "/api/claude-started")
        self.assertNotIn("headers", started[0]["hooks"][0])

    async def test_upgrades_legacy_stop_hook_without_duplicating_it(self):
        os.makedirs(os.path.dirname(self.settings_path))
        with open(self.settings_path, "w") as f:
            legacy = {"type": "http", "url": f"{BASE}/api/claude-stopped"}
            json.dump({"hooks": {"Stop": [{"hooks": [legacy]}]}}, f)

        self.assertTrue(ClaudeHookAction.prepare(self.dir).execute())

        stop = self._stop_hooks(self._read())
        self.assertEqual(len(stop), 1)
        self.assertIn("headers", stop[0])
        self.assertFalse(ClaudeHookAction.prepare(self.dir).execute())

    async def test_preserves_user_defined_pre_tool_use_hooks(self):
        os.makedirs(os.path.dirname(self.settings_path))
        user_group = {"matcher": "Bash", "hooks": [{"type": "command", "command": "lint.sh"}]}
        with open(self.settings_path, "w") as f:
            json.dump({"hooks": {"PreToolUse": [user_group]}}, f)

        ClaudeHookAction.prepare(self.dir).execute()

        pre_tool_use = self._read()["hooks"]["PreToolUse"]
        self.assertIn(user_group, pre_tool_use)
        self.assertEqual(len(pre_tool_use), 2)

    def test_agent_env_carries_agent_id(self):
        env = agent_env(42)
        self.assertEqual(env[AGENT_ID_ENV], "42")
        self.assertIn("PATH", env)

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
