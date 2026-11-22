import unittest

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.ai import ProviderCommand, providers
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestProviderThinkingLevelFlags(unittest.TestCase):
    def test_claude_passes_effort_flag(self):
        command = providers.get("claude").build_command(
            ProviderCommand(model="claude-opus-5", thinking_level="xhigh")
        )
        self.assertEqual(command, "claude --model claude-opus-5 --effort xhigh")

    def test_codex_passes_reasoning_effort_config(self):
        command = providers.get("codex").build_command(
            ProviderCommand(model="gpt-5.6-sol", thinking_level="high", skip_permissions=True)
        )
        self.assertEqual(
            command,
            "codex --config check_for_update_on_startup=false --model gpt-5.6-sol"
            " --config model_reasoning_effort=high --dangerously-bypass-approvals-and-sandbox",
        )

    def test_antigravity_passes_effort_flag(self):
        command = providers.get("gemini").build_command(
            ProviderCommand(model="gemini-3.8-flash", thinking_level="low", binary="agy")
        )
        self.assertEqual(command, "agy --model gemini-3.8-flash --effort low")

    def test_gemini_cli_omits_unsupported_thinking_level(self):
        command = providers.get("gemini").build_command(
            ProviderCommand(model="gemini-3.8-flash", thinking_level="low")
        )
        self.assertNotIn("effort", command)

    def test_unset_thinking_level_is_omitted(self):
        for slug in ("claude", "codex"):
            command = providers.get(slug).build_command(ProviderCommand(model="m"))
            self.assertNotIn("effort", command)


class TestAgentThinkingLevelCommand(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()

    async def _agent(self, **overrides):
        return await AgentFactory.new().create(project_id=self.project.id, **overrides)

    async def test_agent_thinking_level_reaches_cli(self):
        agent = await self._agent(provider="claude", thinking_level="max")
        self.assertIn("--effort max", agent.to_command())

    async def test_level_unsupported_by_current_provider_is_dropped(self):
        agent = await self._agent(provider="claude", thinking_level="none")
        self.assertNotIn("--effort", agent.to_command())
