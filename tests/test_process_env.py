import os
import tempfile
from pathlib import Path
from unittest import mock

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.claude_hook_action import AGENT_ID_ENV, agent_env
from app.services.command_workspace import CommandWorkspace
from app.utils import process_env
from app.utils.process_env import keera_dotenv_keys, user_env
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

KEERA_VENV = "/opt/keera/dist/.venv"
KEERA_KEYS = frozenset({"DB_DATABASE", "DB_CONNECTION", "KEERA_APP_URL"})
LEAKY_ENV = {
    "DB_DATABASE": "storage/keera.db",
    "DB_CONNECTION": "sqlite",
    "KEERA_APP_URL": "http://127.0.0.1:4545",
    "VIRTUAL_ENV": KEERA_VENV,
    "VIRTUAL_ENV_PROMPT": "keera",
    "PATH": os.pathsep.join([f"{KEERA_VENV}/bin", "/usr/local/bin", "/usr/bin"]),
    "HOME": "/Users/someone",
    "SHELL": "/bin/zsh",
}


class TestUserEnv(TestCase):
    def test_strips_keera_dotenv_keys_and_virtualenv_but_keeps_user_env(self):
        env = user_env(LEAKY_ENV, KEERA_KEYS)

        for key in [*KEERA_KEYS, "VIRTUAL_ENV", "VIRTUAL_ENV_PROMPT"]:
            self.assertNotIn(key, env)
        self.assertEqual(env["PATH"], os.pathsep.join(["/usr/local/bin", "/usr/bin"]))
        self.assertEqual(env["HOME"], "/Users/someone")
        self.assertEqual(env["SHELL"], "/bin/zsh")

    def test_reads_keys_from_base_and_environment_dotenv_files(self):
        root = Path(tempfile.mkdtemp())
        (root / ".env").write_text("DB_DATABASE=storage/keera.db\nAPP_ENV=local\n")
        (root / ".env.local").write_text("REVERB_APP_KEY=secret\n")

        keys = keera_dotenv_keys.__wrapped__(root, "local")

        self.assertEqual(keys, {"DB_DATABASE", "APP_ENV", "REVERB_APP_KEY"})


class TestSpawnedProcessEnv(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        for patcher in (
            mock.patch.dict(os.environ, LEAKY_ENV),
            mock.patch.object(process_env, "keera_dotenv_keys", return_value=KEERA_KEYS),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def assert_clean(self, env: dict):
        for key in [*KEERA_KEYS, "VIRTUAL_ENV", "VIRTUAL_ENV_PROMPT"]:
            self.assertNotIn(key, env)
        self.assertNotIn(f"{KEERA_VENV}/bin", env["PATH"].split(os.pathsep))
        self.assertIn("/usr/bin", env["PATH"].split(os.pathsep))
        self.assertEqual(env["HOME"], "/Users/someone")

    async def test_command_run_env_excludes_keera_env(self):
        project = await ProjectFactory.new().create(path=tempfile.mkdtemp())

        env = await (await CommandWorkspace.resolve(project, None)).env()

        self.assert_clean(env)
        self.assertIn("KEERA_PROJECT_ROOT", env)

    def test_agent_pty_env_excludes_keera_env(self):
        env = agent_env(7)

        self.assert_clean(env)
        self.assertEqual(env[AGENT_ID_ENV], "7")
