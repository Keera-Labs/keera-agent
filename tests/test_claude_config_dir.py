import json
import os
import tempfile
from pathlib import Path
from unittest import mock

from fastapi_startkit import Config
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.claude_hook_action import ClaudeHookAction, agent_env
from app.services.claude_config_dir import (
    CONFIG_DIR_ENV,
    agent_config_dir,
    all_config_dirs,
    expand_config_dir,
    project_config_dir,
)
from app.services.claude_usage import claude_projects_dir
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from databases.factories.workspace_factory import WorkspaceFactory
from tests.test_case import TestCase


class TestClaudeConfigDir(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.workspace = await WorkspaceFactory.new().create(claude_config_dir="~/.claude-work")
        self.project = await ProjectFactory.new().create(workspace_id=self.workspace.id)
        self.expanded = os.path.expanduser("~/.claude-work")

    def test_expand_config_dir(self):
        self.assertEqual(expand_config_dir(" ~/.claude-work "), self.expanded)
        self.assertEqual(expand_config_dir("/opt/claude"), "/opt/claude")
        self.assertIsNone(expand_config_dir("  "))
        self.assertIsNone(expand_config_dir(None))

    async def test_project_in_configured_workspace_gets_the_expanded_dir(self):
        self.assertEqual(await project_config_dir(self.project), self.expanded)

    async def test_unassigned_project_gets_no_override(self):
        project = await ProjectFactory.new().create()

        self.assertIsNone(await project_config_dir(project))

    async def test_workspace_without_the_setting_gets_no_override(self):
        workspace = await WorkspaceFactory.new().create()
        project = await ProjectFactory.new().create(workspace_id=workspace.id)

        self.assertIsNone(await project_config_dir(project))

    async def test_codex_agents_are_unaffected(self):
        claude = await AgentFactory.new().create(project_id=self.project.id, provider="claude")
        codex = await AgentFactory.new().create(project_id=self.project.id, provider="codex")

        self.assertEqual(await agent_config_dir(claude, self.project), self.expanded)
        self.assertIsNone(await agent_config_dir(codex, self.project))

    async def test_all_config_dirs_lists_default_then_each_workspace_dir_once(self):
        await WorkspaceFactory.new().create(claude_config_dir="~/.claude-work")

        with mock.patch.dict(os.environ, {CONFIG_DIR_ENV: "/default/claude"}):
            dirs = await all_config_dirs()

        self.assertEqual(dirs[0], "/default/claude")
        self.assertEqual(dirs.count(self.expanded), 1)

    def test_agent_env_sets_claude_config_dir_only_when_given(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(CONFIG_DIR_ENV, None)
            self.assertEqual(agent_env(7, "/tmp/claude-work")[CONFIG_DIR_ENV], "/tmp/claude-work")
            self.assertNotIn(CONFIG_DIR_ENV, agent_env(7))

    def test_transcripts_dir_follows_the_config_dir(self):
        with mock.patch.dict(os.environ, {CONFIG_DIR_ENV: "/default/claude"}):
            os.environ.pop("KEERA_CLAUDE_PROJECTS_DIR", None)
            self.assertEqual(claude_projects_dir(), Path("/default/claude/projects"))
            self.assertEqual(claude_projects_dir("/work"), Path("/work/projects"))

    def test_hooks_stay_project_scoped_and_never_touch_the_config_dir(self):
        # Claude still loads <project>/.claude/settings.json under a custom
        # CLAUDE_CONFIG_DIR, so the project-scope hooks cover every account; a
        # user-scope copy would fire each event twice.
        original_url = Config.get("fastapi.app_url")
        Config.set("fastapi.app_url", "http://example.test:4545")
        self.addCleanup(Config.set, "fastapi.app_url", original_url)
        with tempfile.TemporaryDirectory() as root:
            project_dir = os.path.join(root, "project")
            config_dir = os.path.join(root, "claude-work")
            os.makedirs(config_dir)
            user_settings = os.path.join(config_dir, "settings.json")
            with open(user_settings, "w") as f:
                json.dump({"theme": "dark"}, f)

            ClaudeHookAction.prepare(project_dir).execute()

            with open(os.path.join(project_dir, ".claude", "settings.json")) as f:
                self.assertIn("Stop", json.load(f)["hooks"])
            with open(user_settings) as f:
                self.assertEqual(json.load(f), {"theme": "dark"})
            self.assertEqual(os.listdir(config_dir), ["settings.json"])


class _Spawned(Exception):
    """Raised from the patched PTY factory so no real CLI is ever launched."""


class TestAgentSpawnEnv(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        from fastapi_startkit.application import app

        self.terminals = app().make("terminal")
        self.cwd = tempfile.mkdtemp()

    async def _spawn_env(self, workspace_dir: str | None, provider: str = "claude") -> dict:
        from app.controllers.agent_trigger_controller import _spawn_headless_agent

        workspace = await WorkspaceFactory.new().create(claude_config_dir=workspace_dir)
        project = await ProjectFactory.new().create(path=self.cwd, workspace_id=workspace.id)
        agent = await AgentFactory.new().create(
            project_id=project.id, provider=provider, use_worktree=False
        )
        with (
            mock.patch.dict(os.environ, {}),
            mock.patch.object(self.terminals, "create", side_effect=_Spawned) as create,
        ):
            os.environ.pop(CONFIG_DIR_ENV, None)
            with self.assertRaises(_Spawned):
                await _spawn_headless_agent(agent, project, self.cwd, "hello")
        return create.call_args.kwargs["env"]

    async def test_claude_agent_pty_gets_the_workspace_config_dir(self):
        env = await self._spawn_env("~/.claude-work")

        self.assertEqual(env[CONFIG_DIR_ENV], os.path.expanduser("~/.claude-work"))

    async def test_no_override_without_the_setting(self):
        self.assertNotIn(CONFIG_DIR_ENV, await self._spawn_env(None))

    async def test_codex_agent_pty_gets_no_override(self):
        with mock.patch(
            "app.controllers.agent_trigger_controller.ensure_codex_worktree",
            side_effect=lambda agent, cwd: cwd,
        ):
            env = await self._spawn_env("~/.claude-work", provider="codex")

        self.assertNotIn(CONFIG_DIR_ENV, env)
