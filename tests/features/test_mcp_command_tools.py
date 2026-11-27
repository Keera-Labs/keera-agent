import json

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Agent import Agent
from app.models.Command import Command
from app.models.Project import Project
from app.services.relay_identity import AGENT_TOKEN_HEADER, issue_agent_token
from app.terminal.command_runs import CommandRunRegistry
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase
from tests.test_terminal_shared_pty import _until


class TestMcpCommandTools(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = GitTestRepo(self).init()
        self.repo.write("README.md", "hello\n")
        self.repo.commit_all("initial")
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))
        self.agent = await AgentFactory.new().create(project_id=self.project.id)
        self.registry: CommandRunRegistry = app().make("command_runs")
        self.commands: list[Command] = []

    async def asyncTearDown(self):
        for command in self.commands:
            await self.registry.forget_command(command.id)
        await super().asyncTearDown()

    async def _command(self, label: str, script: str) -> Command:
        command = await Command.create(
            {"project_id": self.project.id, "label": label, "command": script}
        )
        self.commands.append(command)
        return command

    def _agent_worktree(self, agent_id: int):
        return self.repo.add_worktree(f".claude/worktrees/agent-{agent_id}", f"agent-{agent_id}")

    async def _rpc(self, method: str, params: dict | None = None, headers: dict | None = None):
        response = await self.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
            headers=headers or {},
        )
        response.assert_ok()
        return response.json()["result"]

    async def _call(self, name: str, arguments: dict, headers: dict | None = None) -> str:
        result = await self._rpc("tools/call", {"name": name, "arguments": arguments}, headers)
        return result["content"][0]["text"]

    async def test_tools_list_exposes_both_tools_with_project_path_required(self):
        tools = {tool["name"]: tool for tool in (await self._rpc("tools/list"))["tools"]}

        self.assertIn("project_path", tools["list_commands"]["inputSchema"]["required"])
        run_schema = tools["run_command"]["inputSchema"]
        self.assertEqual(set(run_schema["required"]), {"project_path", "command"})
        self.assertIn("actor_agent_id", run_schema["properties"])

    async def test_list_commands_returns_an_empty_list_without_commands(self):
        text = await self._call("list_commands", {"project_path": self.project.path})

        self.assertEqual(json.loads(text), [])

    async def test_list_commands_returns_id_name_and_command(self):
        build = await self._command("Build", "npm run build")
        test = await self._command("Test", "uv run pytest")

        text = await self._call("list_commands", {"project_path": self.project.path})

        self.assertEqual(
            json.loads(text),
            [
                {"id": build.id, "name": "Build", "command": "npm run build"},
                {"id": test.id, "name": "Test", "command": "uv run pytest"},
            ],
        )

    async def test_list_commands_rejects_an_unknown_project(self):
        text = await self._call("list_commands", {"project_path": "/nowhere/at/all"})

        self.assertIn("Error: no Keera project found", text)

    async def test_run_command_runs_in_the_token_callers_worktree(self):
        worktree = self._agent_worktree(self.agent.id)
        command = await self._command("Where", "pwd")
        token = await issue_agent_token(self.agent.id)

        text = await self._call(
            "run_command",
            {"project_path": self.project.path, "command": command.id},
            headers={AGENT_TOKEN_HEADER: token},
        )

        payload = json.loads(text)
        self.assertEqual(payload["cwd"], str(worktree))
        self.assertEqual(payload["command_id"], command.id)
        run = self.registry.get(payload["run_id"])
        self.assertEqual(run.cwd, str(worktree))
        self.assertTrue(await _until(lambda: run.exit_code is not None))
        self.assertIn(str(worktree), run.terminal.history().decode(errors="replace"))

    async def test_run_command_by_name_falls_back_to_actor_agent_id(self):
        worktree = self._agent_worktree(self.agent.id)
        command = await self._command("Sleep", "sleep 5")

        text = await self._call(
            "run_command",
            {
                "project_path": self.project.path,
                "command": "sleep",
                "actor_agent_id": self.agent.id,
            },
        )

        payload = json.loads(text)
        self.assertEqual(payload["status"], "running")
        self.assertEqual(payload["cwd"], str(worktree))
        self.assertIsNotNone(self.registry.find(command.id, str(worktree)))

    async def test_run_command_rejects_an_unknown_command(self):
        self._agent_worktree(self.agent.id)

        for reference in (987654, "missing"):
            with self.subTest(reference=reference):
                text = await self._call(
                    "run_command",
                    {
                        "project_path": self.project.path,
                        "command": reference,
                        "actor_agent_id": self.agent.id,
                    },
                )
                self.assertIn(f"Error: no command '{reference}'", text)

    async def test_run_command_rejects_a_command_of_another_project(self):
        other = await ProjectFactory.new().create()
        foreign = await Command.create({"project_id": other.id, "label": "x", "command": "pwd"})
        self.commands.append(foreign)

        text = await self._call(
            "run_command",
            {
                "project_path": self.project.path,
                "command": foreign.id,
                "actor_agent_id": self.agent.id,
            },
        )

        self.assertIn(f"Error: no command '{foreign.id}'", text)

    async def test_run_command_rejects_an_unknown_project(self):
        text = await self._call(
            "run_command", {"project_path": "/nowhere/at/all", "command": 1, "actor_agent_id": 1}
        )

        self.assertIn("Error: no Keera project found", text)

    async def test_run_command_requires_an_identified_agent_of_the_project(self):
        command = await self._command("Where", "pwd")
        outsider = await AgentFactory.new().create(
            project_id=(await ProjectFactory.new().create()).id
        )

        for arguments in ({}, {"actor_agent_id": 987654}, {"actor_agent_id": outsider.id}):
            with self.subTest(arguments=arguments):
                text = await self._call(
                    "run_command",
                    {"project_path": self.project.path, "command": command.id, **arguments},
                )
                self.assertIn("Error: could not identify the calling agent", text)

    async def test_run_command_rejects_an_agent_without_a_worktree(self):
        command = await self._command("Where", "pwd")

        text = await self._call(
            "run_command",
            {
                "project_path": self.project.path,
                "command": command.id,
                "actor_agent_id": self.agent.id,
            },
        )

        self.assertEqual(text, f"Error: Agent #{self.agent.id} has no worktree")
        self.assertEqual(self.registry.for_project(self.project.id), [])

    async def test_run_command_selects_an_all_digit_name_when_no_id_matches(self):
        worktree = self._agent_worktree(self.agent.id)
        command = await self._command("2024", "pwd")

        text = await self._call(
            "run_command",
            {
                "project_path": self.project.path,
                "command": "2024",
                "actor_agent_id": self.agent.id,
            },
        )

        payload = json.loads(text)
        self.assertEqual(payload["command_id"], command.id)
        self.assertEqual(payload["cwd"], str(worktree))

    async def test_run_command_prefers_an_id_over_an_all_digit_name(self):
        self._agent_worktree(self.agent.id)
        target = await self._command("Target", "pwd")
        await self._command(str(target.id), "pwd")

        text = await self._call(
            "run_command",
            {
                "project_path": self.project.path,
                "command": str(target.id),
                "actor_agent_id": self.agent.id,
            },
        )

        self.assertEqual(json.loads(text)["command_id"], target.id)

    async def test_enforced_project_ignores_an_untokened_actor_agent_id(self):
        await Project.where("id", self.project.id).update({"task_rules": "enforce"})
        await Agent.where("id", self.agent.id).update({"session_id": "live"})
        await issue_agent_token(self.agent.id)
        self._agent_worktree(self.agent.id)
        command = await self._command("Where", "pwd")

        text = await self._call(
            "run_command",
            {
                "project_path": self.project.path,
                "command": command.id,
                "actor_agent_id": self.agent.id,
            },
        )

        self.assertIn("Error: could not identify the calling agent", text)
        self.assertEqual(self.registry.for_project(self.project.id), [])
