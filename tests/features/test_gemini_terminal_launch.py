import json
import os
import tempfile
from pathlib import Path
from unittest import mock

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Agent import Agent
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class _Spawned(Exception):
    pass


class TestGeminiTerminalLaunch(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.terminals = app().make("terminal")
        self.cwd = tempfile.mkdtemp()
        self.bin_dir = tempfile.mkdtemp()
        self.addCleanup(os.environ.__setitem__, "PATH", os.environ.get("PATH", ""))
        os.environ["PATH"] = self.bin_dir

    async def _gemini_agent(self):
        project = await ProjectFactory.new().create(path=self.cwd, is_repository=True)
        return await AgentFactory.new().create(
            project_id=project.id, provider="gemini", model="gemini-3.8-flash", use_worktree=False
        ), project

    def _install_gemini(self) -> None:
        executable = Path(self.bin_dir) / "gemini"
        executable.write_text(
            "#!/bin/sh\nprintf '%s' '--model --resume --approval-mode gemini hooks'\n"
        )
        executable.chmod(0o755)

    async def test_missing_cli_sends_the_error_before_closing(self):
        from app.controllers.terminal_controller import terminal_ws

        agent, project = await self._gemini_agent()
        websocket = mock.AsyncMock()

        with mock.patch.object(self.terminals, "create") as create:
            await terminal_ws(websocket, project.slug, agent_id=agent.id)

        create.assert_not_called()
        error = json.loads(websocket.send_text.await_args.args[0])
        self.assertEqual(error["type"], "error")
        self.assertIn("Install @google/gemini-cli", error["message"])
        websocket.close.assert_awaited_once_with(code=1011, reason="provider unavailable")

    async def test_installed_cli_spawns_a_terminal_running_gemini(self):
        from app.controllers.terminal_controller import terminal_ws

        self._install_gemini()
        agent, project = await self._gemini_agent()

        with (
            mock.patch.object(self.terminals, "create", side_effect=_Spawned),
            self.assertRaises(_Spawned),
        ):
            await terminal_ws(mock.AsyncMock(), project.slug, agent_id=agent.id)

        agent = await Agent.find(agent.id)
        command = agent.to_command(system_prompt_suffix="")
        self.assertIn("gemini --model gemini-3.8-flash", command)
        self.assertIn("--approval-mode", command)
