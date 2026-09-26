"""
Feature tests for GET /api/projects/{project_id}/files (project_file_controller.index).
"""

import os
import tempfile
from pathlib import Path
from unittest import mock

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestProjectFileController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._tmp = tempfile.TemporaryDirectory()
        self._outside = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.addCleanup(self._outside.cleanup)

        self.root = Path(self._tmp.name)
        self.outside = Path(self._outside.name)
        (self.outside / "secret.txt").write_text("secret")

        (self.root / "app" / "controllers").mkdir(parents=True)
        (self.root / "app" / "x.py").write_text("print('x')")
        (self.root / "README.md").write_text("readme")
        (self.root / ".env").write_text("SECRET=1")
        (self.root / ".git").mkdir()

        self.project = await ProjectFactory.new().create(path=str(self.root))

    def url(self, path: str | None = None, project_id: int | None = None) -> str:
        url = f"/api/projects/{project_id or self.project.id}/files"
        return url if path is None else f"{url}?path={path}"

    async def test_lists_root_including_hidden_entries(self):
        response = await self.get(self.url())
        response.assert_ok()
        body = response.json()

        assert body["path"] == ""
        assert body["entries"] == [
            {"name": ".git", "path": ".git", "type": "dir"},
            {"name": "app", "path": "app", "type": "dir"},
            {"name": ".env", "path": ".env", "type": "file"},
            {"name": "README.md", "path": "README.md", "type": "file"},
        ]

    async def test_lists_nested_directory(self):
        response = await self.get(self.url("app"))
        response.assert_ok()

        assert response.json() == {
            "path": "app",
            "entries": [
                {"name": "controllers", "path": "app/controllers", "type": "dir"},
                {"name": "x.py", "path": "app/x.py", "type": "file"},
            ],
            "truncated": False,
        }

    async def test_trailing_slash_is_normalized(self):
        response = await self.get(self.url("app/"))
        response.assert_ok()
        assert response.json()["path"] == "app"

    async def test_sorts_dirs_first_then_case_insensitive_name(self):
        sort_dir = self.root / "sort"
        for name in ["b.txt", "A.txt", "c.txt"]:
            (sort_dir / name).parent.mkdir(exist_ok=True)
            (sort_dir / name).write_text("")
        for name in ["Zeta", "alpha"]:
            (sort_dir / name).mkdir()

        response = await self.get(self.url("sort"))
        response.assert_ok()

        names = [e["name"] for e in response.json()["entries"]]
        assert names == ["alpha", "Zeta", "A.txt", "b.txt", "c.txt"]

    async def test_never_returns_file_contents(self):
        response = await self.get(self.url("app"))
        response.assert_ok()

        assert "print" not in response.text
        for entry in response.json()["entries"]:
            assert set(entry) == {"name", "path", "type"}

    async def test_dot_dot_traversal_returns_400(self):
        for path in ["..", "../", "app/../..", "app/../../etc"]:
            response = await self.get(self.url(path))
            response.assert_status(400)

    async def test_absolute_path_returns_400(self):
        response = await self.get(self.url(str(self.outside)))
        response.assert_status(400)

    async def test_symlink_escaping_root_returns_400(self):
        os.symlink(self.outside, self.root / "escape")

        response = await self.get(self.url("escape"))
        response.assert_status(400)
        assert "secret.txt" not in response.text

    async def test_symlink_escaping_root_is_listed_as_file(self):
        os.symlink(self.outside, self.root / "escape")

        response = await self.get(self.url())
        response.assert_ok()

        escape = next(e for e in response.json()["entries"] if e["name"] == "escape")
        assert escape["type"] == "file"

    async def test_symlink_inside_root_is_allowed(self):
        os.symlink(self.root / "app", self.root / "app-link")

        root_listing = await self.get(self.url())
        link = next(e for e in root_listing.json()["entries"] if e["name"] == "app-link")
        assert link["type"] == "dir"

        response = await self.get(self.url("app-link"))
        response.assert_ok()
        assert response.json() == {
            "path": "app-link",
            "entries": [
                {"name": "controllers", "path": "app-link/controllers", "type": "dir"},
                {"name": "x.py", "path": "app-link/x.py", "type": "file"},
            ],
            "truncated": False,
        }

    async def test_missing_directory_returns_404(self):
        response = await self.get(self.url("does-not-exist"))
        response.assert_status(404)

    async def test_file_path_returns_404(self):
        response = await self.get(self.url("README.md"))
        response.assert_status(404)

    async def test_unknown_project_returns_404(self):
        response = await self.get(self.url(project_id=999999))
        response.assert_status(404)

    async def test_symlink_loop_entry_is_listed_as_file(self):
        os.symlink(self.root / "loop", self.root / "loop")

        response = await self.get(self.url())
        response.assert_ok()

        loop = next(e for e in response.json()["entries"] if e["name"] == "loop")
        assert loop["type"] == "file"

    async def test_symlink_loop_path_returns_400(self):
        os.symlink(self.root / "loop", self.root / "loop")

        response = await self.get(self.url("loop"))
        response.assert_status(400)

    async def test_name_too_long_returns_400(self):
        response = await self.get(self.url("a" * 300))
        response.assert_status(400)

    async def test_dir_removed_before_scan_returns_404(self):
        with mock.patch(
            "app.controllers.project_file_controller.os.scandir",
            side_effect=FileNotFoundError,
        ):
            response = await self.get(self.url("app"))
        response.assert_status(404)

    async def test_dir_replaced_by_file_before_scan_returns_404(self):
        with mock.patch(
            "app.controllers.project_file_controller.os.scandir",
            side_effect=NotADirectoryError,
        ):
            response = await self.get(self.url("app"))
        response.assert_status(404)

    async def test_large_directory_is_truncated(self):
        with mock.patch("app.controllers.project_file_controller.MAX_ENTRIES", 3):
            response = await self.get(self.url())
        response.assert_ok()
        body = response.json()

        assert body["truncated"] is True
        assert [e["name"] for e in body["entries"]] == [".git", "app", ".env"]
