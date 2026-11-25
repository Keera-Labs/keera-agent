import json
import os
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path

from app.ai import ProviderCommand, providers
from app.mcp.tools import SpawnAgentInput
from app.services.antigravity_agent import write_antigravity_rules
from app.services.gemini_cli import gemini_cli_binary, validate_gemini_cli
from app.services.gemini_settings import write_gemini_settings
from app.terminal.terminal import _drawn_dialog

TRUST_LAUNCH_DIRECTORY = ' --settings "{\\"trustedWorkspaces\\":[\\"$PWD\\"]}"'


class TestGeminiProvider(unittest.TestCase):
    def test_native_flags_and_shell_quoting(self):
        command = providers.get("gemini").build_command(
            ProviderCommand(
                model="model; echo unsafe",
                settings_file="/tmp/settings with spaces.json",
                continue_session=True,
                permission_mode="plan",
                skip_permissions=True,
                allowed_tools=["read_file", "run_shell_command(git status)"],
                verbose=True,
            )
        )
        parts = shlex.split(command)
        self.assertIn("model; echo unsafe", parts)
        self.assertIn("--resume", parts)
        self.assertEqual(parts[parts.index("--approval-mode") + 1], "plan")
        self.assertNotIn("--worktree", parts)
        self.assertNotIn("--yolo", parts)
        self.assertIn("--debug", parts)

    def test_skip_permissions_and_default_mode(self):
        for skip, expected in ((False, "default"), (True, "yolo")):
            command = providers.get("gemini").build_command(ProviderCommand(skip_permissions=skip))
            self.assertEqual(command, f"gemini --approval-mode {expected}")

    def test_spawn_schema_accepts_gemini(self):
        self.assertIn(
            "gemini",
            SpawnAgentInput.model_json_schema()["properties"]["provider"]["anyOf"][0]["enum"],
        )

    def test_auth_and_trust_dialogs_block_initial_message(self):
        for option in ("Sign in with Google", "Trust folder (project)"):
            self.assertEqual(_drawn_dialog(f"{option} (Use Enter to select)", 0), option)

    def test_settings_and_context_hook_preserve_native_prompt(self):
        with tempfile.TemporaryDirectory() as directory:
            prompt = Path(directory) / "prompt.txt"
            prompt.write_text("Role instructions with `literal` and $(text)")
            path = write_gemini_settings(
                42,
                "http://127.0.0.1:4545/",
                ProviderCommand(
                    system_prompt_file=str(prompt),
                    disallowed_tools=["write_file"],
                    max_turns=7,
                ),
                storage=Path(directory) / "storage",
                source_home=Path(directory),
            )
            self.assertEqual(Path(path).parent.parent.name, "agent-42")
            settings = json.loads(Path(path).read_text())
            self.assertEqual(
                settings["mcpServers"]["keera"]["httpUrl"], "http://127.0.0.1:4545/mcp"
            )
            self.assertEqual(
                settings["mcpServers"]["keera"]["headers"],
                {"X-Keera-Agent-Token": "${KEERA_AGENT_TOKEN:-}"},
            )
            self.assertEqual(settings["tools"]["exclude"], ["write_file"])
            self.assertEqual(settings["model"]["maxSessionTurns"], 7)
            self.assertNotIn("GEMINI_SYSTEM_MD", path)
            hooks = settings["hooks"]
            self.assertIn("/api/claude-stopped", hooks["AfterAgent"][0]["hooks"][0]["command"])
            command = hooks["BeforeAgent"][0]["hooks"][0]["command"]
            self.assertIn("X-Keera-Agent-Id: 42", command)
            context = json.loads((Path(path).parent / "context.json").read_text())
            self.assertEqual(context["hookSpecificOutput"]["additionalContext"], prompt.read_text())
            self.assertEqual(Path(path).stat().st_mode & 0o777, 0o600)

    def test_user_settings_and_cached_auth_are_preserved_with_isolated_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "user" / ".gemini"
            source.mkdir(parents=True)
            original = {
                "security": {"auth": {"selectedType": "oauth-personal"}},
                "mcpServers": {"other": {"httpUrl": "http://example.test/mcp"}},
                "tools": {"exclude": ["read_file"]},
                "hooks": {
                    "AfterAgent": [{"hooks": [{"type": "command", "command": "printf '{}'"}]}]
                },
            }
            (source / "settings.json").write_text(json.dumps(original))
            (source / "oauth_creds.json").write_text("{}")
            options = ProviderCommand(disallowed_tools=["write_file"])
            first = write_gemini_settings(
                1,
                "http://localhost:4545",
                options,
                storage=root / "storage",
                source_home=source.parent,
            )
            second = write_gemini_settings(
                2,
                "http://localhost:4545",
                options,
                storage=root / "storage",
                source_home=source.parent,
            )
            settings = json.loads(Path(first).read_text())
            self.assertEqual(settings["security"], original["security"])
            self.assertIn("other", settings["mcpServers"])
            self.assertEqual(settings["tools"]["exclude"], ["read_file", "write_file"])
            self.assertEqual(len(settings["hooks"]["AfterAgent"]), 2)
            self.assertTrue((Path(first).parent / "oauth_creds.json").is_symlink())
            self.assertEqual(json.loads((source / "settings.json").read_text()), original)
            self.assertNotEqual(Path(first).parent, Path(second).parent)
            self.assertFalse((Path(first).parent / "tmp").is_symlink())
            again = write_gemini_settings(
                1,
                "http://localhost:4545",
                options,
                storage=root / "storage",
                source_home=source.parent,
            )
            self.assertEqual(first, again)
            self.assertEqual(len(json.loads(Path(again).read_text())["hooks"]["AfterAgent"]), 2)

    def test_login_selection_in_agent_home_survives_command_rebuild(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            options = ProviderCommand()
            path = write_gemini_settings(
                1,
                "http://localhost:4545",
                options,
                storage=root / "storage",
                source_home=root / "user",
            )
            settings = json.loads(Path(path).read_text())
            settings["security"]["auth"] = {"selectedType": "oauth-personal"}
            Path(path).write_text(json.dumps(settings))
            write_gemini_settings(
                1,
                "http://localhost:4545",
                options,
                storage=root / "storage",
                source_home=root / "user",
            )
            settings = json.loads(Path(path).read_text())
            self.assertEqual(settings["security"]["auth"]["selectedType"], "oauth-personal")
            self.assertEqual(len(settings["hooks"]["BeforeAgent"]), 1)

    def test_missing_and_unsupported_cli_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            original = os.environ.get("PATH", "")
            os.environ["PATH"] = directory
            try:
                with self.assertRaisesRegex(RuntimeError, "Install @google/gemini-cli"):
                    validate_gemini_cli("gemini")
                executable = Path(directory) / "gemini"
                executable.write_text("#!/bin/sh\nprintf 'old help'\n")
                executable.chmod(0o755)
                with self.assertRaisesRegex(RuntimeError, "unsupported"):
                    validate_gemini_cli("gemini")
                executable.write_text(
                    "#!/bin/sh\nprintf '%s' '--model --resume --approval-mode gemini hooks'\n"
                )
                validate_gemini_cli("gemini")
                validate_gemini_cli("codex")
            finally:
                os.environ["PATH"] = original

    def test_antigravity_cli_is_used_when_gemini_is_absent(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(gemini_cli_binary(directory))
            agy = Path(directory) / "agy"
            agy.write_text(
                "#!/bin/sh\nprintf '%s' '--model --mode --continue "
                "--dangerously-skip-permissions --add-dir --settings' >&2\n"
            )
            agy.chmod(0o755)
            self.assertEqual(gemini_cli_binary(directory), "agy")
            original = os.environ.get("PATH", "")
            os.environ["PATH"] = directory
            try:
                validate_gemini_cli("gemini")
            finally:
                os.environ["PATH"] = original
            gemini = Path(directory) / "gemini"
            gemini.write_text("#!/bin/sh\n")
            gemini.chmod(0o755)
            self.assertEqual(gemini_cli_binary(directory), "gemini")

    def test_antigravity_flags(self):
        gemini = providers.get("gemini")
        self.assertEqual(
            gemini.build_command(
                ProviderCommand(
                    binary="agy",
                    model="gemini-3.8-flash",
                    continue_session=True,
                    skip_permissions=True,
                    allowed_tools=["read_file"],
                    verbose=True,
                    settings_file="/tmp/settings.json",
                )
            ),
            "agy --model gemini-3.8-flash --continue --dangerously-skip-permissions"
            + TRUST_LAUNCH_DIRECTORY,
        )
        self.assertEqual(
            gemini.build_command(
                ProviderCommand(binary="agy", permission_mode="plan", skip_permissions=True)
            ),
            "agy --mode plan" + TRUST_LAUNCH_DIRECTORY,
        )
        self.assertEqual(
            gemini.build_command(ProviderCommand(binary="agy")), "agy" + TRUST_LAUNCH_DIRECTORY
        )
        self.assertEqual(
            gemini.build_command(
                ProviderCommand(binary="agy", rules_dir="/tmp/agent 7", continue_session=True)
            ),
            "agy --add-dir '/tmp/agent 7' --continue" + TRUST_LAUNCH_DIRECTORY,
        )

    def test_antigravity_trusts_the_directory_it_launches_in(self):
        command = providers.get("gemini").build_command(
            ProviderCommand(binary="agy", skip_permissions=True)
        )
        with tempfile.TemporaryDirectory() as directory:
            launched = subprocess.run(
                ["/bin/sh", "-c", command.replace("agy", "printf '%s\\n'", 1)],
                capture_output=True,
                text=True,
                cwd=directory,
                env={**os.environ, "PWD": directory},
                check=True,
            )
        arguments = launched.stdout.splitlines()
        settings = json.loads(arguments[arguments.index("--settings") + 1])
        self.assertEqual(settings, {"trustedWorkspaces": [directory]})

    def test_antigravity_role_prompt_is_an_always_on_rule_outside_the_repo(self):
        with tempfile.TemporaryDirectory() as directory:
            prompt = Path(directory) / "prompt.txt"
            prompt.write_text("You are the SE agent.")
            rules_dir = write_antigravity_rules(7, str(prompt), Path(directory) / "antigravity")
            self.assertEqual(rules_dir, str(Path(directory) / "antigravity" / "agent-7"))
            self.assertEqual(
                (Path(rules_dir) / ".agents" / "rules" / "keera-agent.md").read_text(),
                "---\ntrigger: always_on\n---\nYou are the SE agent.",
            )

    def test_antigravity_without_role_prompt_adds_no_rules(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(write_antigravity_rules(7, None, Path(directory)))
            self.assertEqual(list(Path(directory).iterdir()), [])
