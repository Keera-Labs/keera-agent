"""
Feature tests for the Files filters (Settings > Editor) applied by
GET /api/projects/{project_id}/files.
"""

import subprocess
import tempfile
from pathlib import Path
from unittest import mock

from app.models.GlobalSettings import GlobalSettings
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

SETTINGS_URL = "/api/settings/editor"


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


class TestProjectFileFilters(TestCase):
    """Settings are saved over HTTP (committed), so the row is removed by hand."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        await GlobalSettings.where("key", "editor").delete()
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name).resolve()

        (self.root / "src").mkdir()
        (self.root / "src" / "main.py").write_text("")
        (self.root / "src" / "debug.log").write_text("")
        (self.root / "build").mkdir()
        (self.root / "node_modules").mkdir()
        (self.root / ".github").mkdir()
        (self.root / ".env").write_text("")
        (self.root / "app.log").write_text("")
        (self.root / "keep.log").write_text("")
        (self.root / "README.md").write_text("")
        (self.root / ".gitignore").write_text("build/\nnode_modules/\n*.log\n")

        self.project = await ProjectFactory.new().create(path=str(self.root))

    async def asyncTearDown(self):
        await GlobalSettings.where("key", "editor").delete()
        await super().asyncTearDown()

    async def save_filters(self, **filters):
        response = await self.patch(
            SETTINGS_URL, json={"font_family": "fira-code", "font_size": 13, **filters}
        )
        response.assert_ok()

    async def names(self, path: str = "") -> list[str]:
        response = await self.get(f"/api/projects/{self.project.id}/files?path={path}")
        response.assert_ok()
        return [e["name"] for e in response.json()["entries"]]

    def init_repo(self):
        _git(self.root, "init", "-q")
        # A tracked file stays visible even though *.log ignores it.
        _git(self.root, "add", "-f", "keep.log")

    async def test_lists_everything_by_default(self):
        self.init_repo()

        assert await self.names() == [
            ".git", ".github", "build", "node_modules", "src",
            ".env", ".gitignore", "app.log", "keep.log", "README.md",
        ]  # fmt: skip

    async def test_hide_hidden_drops_dotfiles_and_dot_folders(self):
        await self.save_filters(hide_hidden=True)

        assert await self.names() == [
            "build",
            "node_modules",
            "src",
            "app.log",
            "keep.log",
            "README.md",
        ]

    async def test_hide_ignored_uses_gitignore_but_keeps_tracked_files(self):
        self.init_repo()
        await self.save_filters(hide_ignored=True)

        assert await self.names() == [
            ".git",
            ".github",
            "src",
            ".env",
            ".gitignore",
            "keep.log",
            "README.md",
        ]
        assert await self.names("src") == ["main.py"]

    async def test_hide_ignored_checks_a_listing_with_one_git_call(self):
        self.init_repo()
        await self.save_filters(hide_ignored=True)

        with mock.patch("app.utils.file_filters.subprocess.run", wraps=subprocess.run) as run:
            await self.names()

        assert run.call_count == 1
        assert run.call_args.args[0] == ["git", "check-ignore", "--stdin", "-z"]

    async def test_hide_ignored_is_skipped_outside_a_git_repo(self):
        await self.save_filters(hide_ignored=True)

        assert "build" in await self.names()
        assert "app.log" in await self.names()

    async def test_hide_ignored_survives_a_missing_git_binary(self):
        self.init_repo()
        await self.save_filters(hide_ignored=True)

        with mock.patch("app.utils.file_filters.subprocess.run", side_effect=FileNotFoundError):
            assert "build" in await self.names()

    async def test_patterns_match_names_paths_and_folders_only(self):
        (self.root / "src" / "build").write_text("a file named like the folder")
        await self.save_filters(hidden_patterns=["*.md", "build/", "src/*.log"])

        assert await self.names() == [
            ".github", "node_modules", "src", ".env", ".gitignore", "app.log", "keep.log",
        ]  # fmt: skip
        assert await self.names("src") == ["build", "main.py"]

    async def test_filters_combine(self):
        self.init_repo()
        await self.save_filters(hide_hidden=True, hide_ignored=True, hidden_patterns=["README.md"])

        assert await self.names() == ["src", "keep.log"]
