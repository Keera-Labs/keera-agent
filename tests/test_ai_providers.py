import unittest

from app.ai import ProviderCommand, providers


class TestAIProviders(unittest.TestCase):
    def test_builtin_providers_are_registered(self):
        self.assertEqual([provider.slug for provider in providers.all()], ["codex", "claude"])
        self.assertIn("gpt-5.6-luna", providers.get("codex").default_models)
        self.assertIn("gpt-5.6-terra", providers.get("codex").default_models)
        self.assertIn("gpt-5.6-sol", providers.get("codex").default_models)
        self.assertIn("claude-opus-4-8", providers.get("claude").default_models)

    def test_unknown_provider_raises_clear_error(self):
        with self.assertRaisesRegex(ValueError, "Unknown AI provider: missing"):
            providers.get("missing")

    def test_claude_builds_existing_cli_shape(self):
        command = providers.get("claude").build_command(
            ProviderCommand(model="claude-sonnet-5", worktree="agent-7", continue_session=True)
        )
        self.assertEqual(command, "claude --worktree agent-7 --continue --model claude-sonnet-5")

    def test_codex_builds_new_session_command(self):
        command = providers.get("codex").build_command(
            ProviderCommand(model="gpt-5.3-codex", skip_permissions=True)
        )
        self.assertEqual(
            command,
            "codex --model gpt-5.3-codex --dangerously-bypass-approvals-and-sandbox",
        )

    def test_codex_builds_resume_command(self):
        command = providers.get("codex").build_command(
            ProviderCommand(model="gpt-5.3-codex", continue_session=True, permission_mode="plan")
        )
        self.assertEqual(command, "codex resume --last --model gpt-5.3-codex --sandbox read-only")
