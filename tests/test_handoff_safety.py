import asyncio
import base64
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from app.requests.handoff_request import HandoffPaths
from app.services.handoff.git_snapshot import looks_secret
from app.services.handoff.tasks import heartbeat
from app.services.handoff.transcript import PathRewriter, install_session
from app.services.handoff.urls import rewrite_keera_urls

SESSION = "abc-123"


class TestSecretHeuristic(unittest.TestCase):
    def test_flags_credentials_case_insensitively(self):
        secrets = [
            ".env",
            ".ENV",
            ".env.production",
            "config/prod.env",
            ".envrc",
            "id_rsa",
            "id_dsa",
            "id_ecdsa",
            "id_ed25519_work",
            "server.pem",
            "tls.KEY",
            "client.p12",
            "cert.pfx",
            "release.jks",
            "app.keystore",
            ".npmrc",
            ".pypirc",
            ".netrc",
            ".git-credentials",
            ".aws/credentials",
            "home/.aws/config",
            ".ssh/known_hosts",
            "credentials.json",
            "gcp-key.json",
            "service-account-prod.json",
            "terraform.tfvars",
            "infra/prod.tfvars.json",
            "terraform.tfstate",
            "secrets.yaml",
            ".claude/settings.local.json",
            ".docker/config.json",
            ".htpasswd",
            ".s3cfg",
            ".boto",
            ".vault-token",
            "client_secret_123.apps.googleusercontent.com.json",
            "kubeconfig",
            "ops/prod.kubeconfig",
            "signing/private.asc",
        ]
        for path in secrets:
            with self.subTest(path=path):
                self.assertTrue(looks_secret(path))

    def test_leaves_ordinary_and_template_files_alone(self):
        safe = [
            ".env.example",
            ".env.sample",
            "config/.env.template",
            "id_rsa.pub",
            "app.py",
            "README.md",
            "package.json",
            "environment.ts",
            "keyboard.json",
            "docs/credentials-guide.md",
            "kubeconfig.md",
            "client.json",
        ]
        for path in safe:
            with self.subTest(path=path):
                self.assertFalse(looks_secret(path))


class TestKeeraUrlRewrite(unittest.TestCase):
    def test_rewrites_the_source_origin_and_its_aliases(self):
        text = (
            "curl http://127.0.0.1:4545/mcp; MCP at http://box.ts.net:4545/mcp, "
            "tasks http://localhost:4545/api/tasks; other http://example.com:8080/mcp; "
            "port lookalike http://127.0.0.1:45450/mcp"
        )
        rewritten = rewrite_keera_urls(text, "http://127.0.0.1:4545", "https://cloud.test")
        self.assertEqual(
            rewritten,
            "curl https://cloud.test/mcp; MCP at https://cloud.test/mcp, "
            "tasks https://cloud.test/api/tasks; other http://example.com:8080/mcp; "
            "port lookalike http://127.0.0.1:45450/mcp",
        )


class TestInstallSessionCleanup(unittest.TestCase):
    def test_a_failure_midway_removes_the_files_already_written(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            files = [
                {"path": f"{SESSION}.jsonl", "encoding": "text", "content": '{"a": 1}\n'},
                {"path": f"{SESSION}/a.txt", "encoding": "text", "content": "ok"},
                {"path": f"{SESSION}/b.bin", "encoding": "base64", "content": "!!not-base64"},
            ]

            with self.assertRaises(ValueError):
                install_session(directory, SESSION, files, PathRewriter({}))

            self.assertEqual([p for p in directory.rglob("*") if p.is_file()], [])

    def test_writes_every_file_when_all_succeed(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            raw = base64.b64encode(b"\x00\xff").decode()
            files = [
                {"path": f"{SESSION}.jsonl", "encoding": "text", "content": '{"a": 1}\n'},
                {"path": f"{SESSION}/b.bin", "encoding": "base64", "content": raw},
            ]

            written = install_session(directory, SESSION, files, PathRewriter({}))

            self.assertEqual(len(written), 2)
            self.assertEqual((directory / SESSION / "b.bin").read_bytes(), b"\x00\xff")


class TestHeartbeat(unittest.IsolatedAsyncioTestCase):
    async def test_beats_while_the_work_runs_survives_a_failure_and_stops_after(self):
        beats = []

        async def beat():
            beats.append(len(beats))
            if len(beats) == 2:
                raise RuntimeError("database is locked")

        async with heartbeat(beat, interval=0.01):
            await asyncio.sleep(0.08)
        counted = len(beats)
        await asyncio.sleep(0.05)

        self.assertGreaterEqual(counted, 3)
        self.assertEqual(len(beats), counted)


class TestHandoffPaths(unittest.TestCase):
    def valid(self, **overrides):
        values = {
            "worktree": "/home/a/app/.claude/worktrees/agent-1",
            "project": "/home/a/app",
            "home": "/home/a",
            "config_dir": "/home/a/.claude",
            **overrides,
        }
        return HandoffPaths(**values)

    def test_accepts_specific_absolute_paths(self):
        self.assertEqual(self.valid(home="/home/a/").home, "/home/a")
        self.assertEqual(self.valid(home="/root").home, "/root")

    def test_rejects_root_short_and_relative_paths(self):
        for home in ("/", "//", "/home", "/Users", "/tmp", "/a", "home/a", "", "/home/../"):
            with self.subTest(home=home), self.assertRaises(ValidationError):
                self.valid(home=home)


if __name__ == "__main__":
    unittest.main()
