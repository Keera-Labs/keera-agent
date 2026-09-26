"""Throwaway git repositories for the Source Control API tests.

Every repo lives in a temp dir and any "remote" is a local bare repo, so tests never
touch a real checkout or network remote.
"""

import os
import subprocess
import tempfile
from pathlib import Path
from unittest import mock

# Isolate from the developer's global/system git config (signing, hooksPath, ...).
ISOLATED_GIT_ENV = {
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "Test",
    "GIT_AUTHOR_EMAIL": "test@example.com",
    "GIT_COMMITTER_NAME": "Test",
    "GIT_COMMITTER_EMAIL": "test@example.com",
}


class GitTestRepo:
    def __init__(self, test_case):
        tmp = tempfile.TemporaryDirectory()
        test_case.addCleanup(tmp.cleanup)
        env_patch = mock.patch.dict(os.environ, ISOLATED_GIT_ENV)
        env_patch.start()
        test_case.addCleanup(env_patch.stop)

        self.base = Path(tmp.name).resolve()
        self.root = self.base / "project"
        self.root.mkdir()

    def init(self) -> "GitTestRepo":
        self.git("init", "-q", "-b", "main")
        return self

    def git(self, *args: str, cwd: Path | None = None) -> str:
        return subprocess.run(
            ["git", *args], cwd=cwd or self.root, check=True, capture_output=True, text=True
        ).stdout

    def write(self, path: str, content: str | bytes) -> Path:
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            target.write_bytes(content)
        else:
            target.write_text(content)
        return target

    def commit_all(self, message: str = "commit") -> str:
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD").strip()

    def add_bare_remote(self, name: str = "origin") -> Path:
        remote = self.base / f"{name}.git"
        self.git("init", "-q", "--bare", str(remote), cwd=self.base)
        self.git("remote", "add", name, str(remote))
        return remote

    def fake_gh(self, script: str) -> Path:
        """Write an executable stand-in for `gh`; it logs its argv to gh-args.txt."""
        gh = self.base / "gh"
        gh.write_text(f'#!/bin/sh\necho "$@" >> "{self.base}/gh-args.txt"\n{script}\n')
        gh.chmod(0o755)
        return gh

    def gh_args(self) -> list[str]:
        log = self.base / "gh-args.txt"
        return log.read_text().splitlines() if log.exists() else []
