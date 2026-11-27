import asyncio
import os
import unittest
from unittest import mock

from app.actions.claude_hook_action import AGENT_ID_ENV, agent_env
from app.terminal.terminal import OH_MY_ZSH_DISABLE_ENV, Terminal, build_pty_env
from app.utils.process_env import user_env


class TestBuildPtyEnv(unittest.TestCase):
    def test_adds_oh_my_zsh_disable_vars_and_color_defaults(self):
        env = build_pty_env({"HOME": "/Users/tester", "SHELL": "/bin/zsh"})

        self.assertEqual(env["DISABLE_AUTO_UPDATE"], "true")
        self.assertEqual(env["DISABLE_UPDATE_PROMPT"], "true")
        self.assertEqual(env["TERM"], "xterm-256color")
        self.assertEqual(env["COLORTERM"], "truecolor")
        self.assertEqual(env["HOME"], "/Users/tester")
        self.assertEqual(env["SHELL"], "/bin/zsh")

    def test_preserves_existing_env_and_agent_id_without_mutating_caller(self):
        source = {
            **agent_env(42),
            "CUSTOM_VAR": "keep-me",
            "TERM": "xterm",
            "DISABLE_AUTO_UPDATE": "false",
        }
        snapshot = dict(source)

        env = build_pty_env(source)

        self.assertEqual(source, snapshot)
        self.assertEqual(env[AGENT_ID_ENV], "42")
        self.assertEqual(env["CUSTOM_VAR"], "keep-me")
        self.assertEqual(env["TERM"], "xterm")
        self.assertEqual(env["DISABLE_AUTO_UPDATE"], "true")
        self.assertEqual(env["DISABLE_UPDATE_PROMPT"], "true")

    def test_uses_process_environ_when_env_is_none(self):
        with mock.patch.dict(os.environ, {"KEERA_TEST_MARKER": "present"}):
            env = build_pty_env()

        self.assertEqual(env["KEERA_TEST_MARKER"], "present")
        for key, value in OH_MY_ZSH_DISABLE_ENV.items():
            self.assertEqual(env[key], value)

    def test_terminal_applies_pty_env_for_agent_and_project_shells(self):
        agent_terminal = Terminal(env=agent_env(99))
        shell_terminal = Terminal(env=user_env())
        default_terminal = Terminal()

        for terminal in (agent_terminal, shell_terminal, default_terminal):
            self.assertEqual(terminal._env["DISABLE_AUTO_UPDATE"], "true")
            self.assertEqual(terminal._env["DISABLE_UPDATE_PROMPT"], "true")
        self.assertEqual(agent_terminal.agent_id, "99")


class TestTerminalSpawnedEnv(unittest.IsolatedAsyncioTestCase):
    async def test_spawned_pty_process_receives_omz_disable_vars_and_agent_id(self):
        terminal = Terminal(
            shell="/bin/sh",
            args=[
                "-c",
                'printf "auto=%s prompt=%s agent=%s\\n" '
                '"$DISABLE_AUTO_UPDATE" "$DISABLE_UPDATE_PROMPT" "$KEERA_AGENT_ID"',
            ],
            env=agent_env(123),
        )
        terminal.start()
        queue = terminal.subscribe()
        chunks = bytearray()
        try:
            deadline = asyncio.get_running_loop().time() + 5.0
            while b"agent=123" not in chunks:
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    break
                try:
                    chunks += await asyncio.wait_for(queue.get(), timeout=min(0.2, remaining))
                except TimeoutError:
                    if not terminal.is_alive():
                        break
        finally:
            terminal.unsubscribe(queue)
            await terminal.aclose()

        output = chunks.decode(errors="replace")
        self.assertIn("auto=true prompt=true agent=123", output)
