import json
import os
import tempfile
from unittest import mock

from fastapi_startkit import Config
from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

TAILNET_URL = "http://my-host.tail6b2d9f.ts.net:4545"


class _Spawned(Exception):
    pass


def _stale_tailnet_settings() -> dict:
    return {
        "permissions": {"deny": ["Agent"]},
        "hooks": {
            "Stop": [{"hooks": [{"type": "http", "url": f"{TAILNET_URL}/api/claude-stopped"}]}],
            "PostToolUse": [
                {"hooks": [{"type": "http", "url": f"{TAILNET_URL}/api/agent-hook-events"}]}
            ],
        },
    }


class TestAgentSpawnHookSync(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.terminals = app().make("terminal")
        self.cwd = tempfile.mkdtemp()
        self.settings_path = os.path.join(self.cwd, ".claude", "settings.json")
        original_url = Config.get("fastapi.app_url")
        original_override = Config.get("fastapi.hook_url")
        Config.set("fastapi.app_url", TAILNET_URL)
        Config.set("fastapi.hook_url", "")
        self.addCleanup(Config.set, "fastapi.app_url", original_url)
        self.addCleanup(Config.set, "fastapi.hook_url", original_override)

    def _write_stale_settings(self) -> None:
        os.makedirs(os.path.dirname(self.settings_path), exist_ok=True)
        with open(self.settings_path, "w") as f:
            json.dump(_stale_tailnet_settings(), f)

    def _read_settings(self) -> dict:
        with open(self.settings_path) as f:
            return json.load(f)

    async def _agent_and_project(self):
        project = await ProjectFactory.new().create(path=self.cwd, is_repository=True)
        agent = await AgentFactory.new().create(
            project_id=project.id, provider="claude", use_worktree=False
        )
        return agent, project

    async def _spawn_headless(self, agent, project) -> None:
        from app.controllers.agent_trigger_controller import _spawn_headless_agent

        await _spawn_headless_agent(agent, project, self.cwd, "hello")

    async def _spawn_websocket(self, agent, project) -> None:
        from app.controllers.terminal_controller import terminal_ws

        await terminal_ws(mock.AsyncMock(), project.slug, agent_id=agent.id)

    async def _spawn_with_stale_settings(self, spawn) -> dict:
        self._write_stale_settings()
        agent, project = await self._agent_and_project()
        with (
            mock.patch.object(self.terminals, "create", side_effect=_Spawned),
            self.assertRaises(_Spawned),
        ):
            await spawn(agent, project)
        return self._read_settings()

    def _assert_hooks_on_loopback(self, settings: dict) -> None:
        urls = [
            h["url"] for groups in settings["hooks"].values() for g in groups for h in g["hooks"]
        ]
        self.assertIn("http://127.0.0.1:4545/api/claude-stopped", urls)
        for url in urls:
            self.assertTrue(url.startswith("http://127.0.0.1:4545/api/"), url)

    async def test_headless_spawn_moves_stale_tailnet_hooks_to_loopback(self):
        settings = await self._spawn_with_stale_settings(self._spawn_headless)

        self._assert_hooks_on_loopback(settings)
        self.assertEqual(settings["permissions"], {"deny": ["Agent"]})

    async def test_websocket_spawn_moves_stale_tailnet_hooks_to_loopback(self):
        settings = await self._spawn_with_stale_settings(self._spawn_websocket)

        self._assert_hooks_on_loopback(settings)
        self.assertEqual(settings["permissions"], {"deny": ["Agent"]})

    async def test_stop_hook_is_attributed_to_the_agent_after_sync(self):
        settings = await self._spawn_with_stale_settings(self._spawn_websocket)

        stop = settings["hooks"]["Stop"][0]["hooks"][0]
        self.assertEqual(stop["headers"], {"X-Keera-Agent-Id": "$KEERA_AGENT_ID"})
        self.assertEqual(stop["allowedEnvVars"], ["KEERA_AGENT_ID"])
