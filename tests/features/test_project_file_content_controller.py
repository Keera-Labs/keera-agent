"""
Feature tests for the file content endpoints used by the editor:
- GET /api/projects/{project_id}/files/content  (project_file_content_controller.show)
- PUT /api/projects/{project_id}/files/content  (project_file_content_controller.update)
"""

import hashlib
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import quote

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.controllers.project_file_content_controller import MAX_BYTES
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class ProjectFileContentTestCase(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._tmp = tempfile.TemporaryDirectory()
        self._outside = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.addCleanup(self._outside.cleanup)

        self.root = Path(self._tmp.name)
        self.outside = Path(self._outside.name)
        self.secret = self.outside / "secret.txt"
        self.secret.write_text("secret")

        (self.root / "app").mkdir()
        self.file = self.root / "app" / "x.py"
        self.file.write_text("print('héllo')\n")

        self.project = await ProjectFactory.new().create(path=str(self.root))

    def url(self, path: str | None, project_id: int | None = None) -> str:
        url = f"/api/projects/{project_id or self.project.id}/files/content"
        return url if path is None else f"{url}?path={quote(path)}"


class TestShowFileContent(ProjectFileContentTestCase):
    async def test_returns_content_and_metadata(self):
        data = self.file.read_bytes()

        response = await self.get(self.url("app/x.py"))
        response.assert_ok()

        assert response.json() == {
            "path": "app/x.py",
            "content": "print('héllo')\n",
            "etag": sha256(data),
            "size": len(data),
            "encoding": "utf-8",
        }

    async def test_symlink_inside_root_is_allowed(self):
        os.symlink(self.file, self.root / "link.py")

        response = await self.get(self.url("link.py"))
        response.assert_ok()
        assert response.json()["path"] == "link.py"
        assert response.json()["content"] == "print('héllo')\n"

    async def test_dot_dot_traversal_returns_400(self):
        for path in ["../secret.txt", "app/../../secret.txt"]:
            response = await self.get(self.url(path))
            response.assert_status(400)

    async def test_absolute_path_returns_400(self):
        response = await self.get(self.url(str(self.secret)))
        response.assert_status(400)
        assert "secret" not in response.json().get("content", "")

    async def test_symlink_escaping_root_returns_400(self):
        os.symlink(self.secret, self.root / "escape.txt")

        response = await self.get(self.url("escape.txt"))
        response.assert_status(400)
        assert "content" not in response.json()

    async def test_missing_file_returns_404(self):
        response = await self.get(self.url("app/missing.py"))
        response.assert_status(404)

    async def test_directory_returns_404(self):
        response = await self.get(self.url("app"))
        response.assert_status(404)

    async def test_unknown_project_returns_404(self):
        response = await self.get(self.url("app/x.py", project_id=999999))
        response.assert_status(404)

    async def test_file_over_2mb_returns_413(self):
        (self.root / "big.txt").write_bytes(b"a" * (MAX_BYTES + 1))

        response = await self.get(self.url("big.txt"))
        response.assert_status(413)

    async def test_file_of_exactly_2mb_is_allowed(self):
        (self.root / "edge.txt").write_bytes(b"a" * MAX_BYTES)

        response = await self.get(self.url("edge.txt"))
        response.assert_ok()
        assert response.json()["size"] == MAX_BYTES

    async def test_binary_file_returns_415(self):
        (self.root / "image.bin").write_bytes(b"PNG\x00\x01\x02")

        response = await self.get(self.url("image.bin"))
        response.assert_status(415)

    async def test_non_utf8_file_returns_415(self):
        (self.root / "latin1.txt").write_bytes("café".encode("latin-1"))

        response = await self.get(self.url("latin1.txt"))
        response.assert_status(415)

    @unittest.skipIf(os.geteuid() == 0, "root ignores file permissions")
    async def test_unreadable_file_returns_403(self):
        self.file.chmod(0)
        self.addCleanup(self.file.chmod, 0o644)

        response = await self.get(self.url("app/x.py"))
        response.assert_status(403)

    async def test_fifo_returns_404_without_blocking(self):
        # No pre-open stat on the read path: this exercises O_NONBLOCK + fstat.
        os.mkfifo(self.root / "pipe")

        response = await self.get(self.url("pipe"))
        response.assert_status(404)

    async def test_missing_path_returns_422(self):
        response = await self.get(self.url(None), headers={"Accept": "application/json"})
        response.assert_status(422)


class TestUpdateFileContent(ProjectFileContentTestCase):
    def current_etag(self, path: Path | None = None) -> str:
        return sha256((path or self.file).read_bytes())

    async def test_saves_content_and_returns_new_etag(self):
        response = await self.put(
            self.url("app/x.py"), json={"content": "print('bye')\n", "etag": self.current_etag()}
        )
        response.assert_ok()

        new = b"print('bye')\n"
        assert self.file.read_bytes() == new
        assert response.json() == {"path": "app/x.py", "etag": sha256(new), "size": len(new)}

        reread = await self.get(self.url("app/x.py"))
        assert reread.json()["etag"] == response.json()["etag"]

    async def test_atomic_write_preserves_mode_and_leaves_no_temp_files(self):
        self.file.chmod(0o640)

        response = await self.put(
            self.url("app/x.py"), json={"content": "changed", "etag": self.current_etag()}
        )
        response.assert_ok()

        assert stat.S_IMODE(self.file.stat().st_mode) == 0o640
        assert sorted(p.name for p in (self.root / "app").iterdir()) == ["x.py"]

    async def test_symlink_inside_root_writes_through_to_target(self):
        link = self.root / "link.py"
        os.symlink(self.file, link)

        response = await self.put(
            self.url("link.py"), json={"content": "via link", "etag": self.current_etag()}
        )
        response.assert_ok()

        assert link.is_symlink()
        assert self.file.read_text() == "via link"

    async def test_stale_etag_returns_409_with_current_etag(self):
        stale = self.current_etag()
        self.file.write_text("edited elsewhere")

        response = await self.put(self.url("app/x.py"), json={"content": "mine", "etag": stale})
        response.assert_status(409)

        assert response.json()["etag"] == self.current_etag()
        assert self.file.read_text() == "edited elsewhere"

    async def test_content_over_2mb_returns_413(self):
        original = self.file.read_bytes()

        response = await self.put(
            self.url("app/x.py"),
            json={"content": "a" * (MAX_BYTES + 1), "etag": self.current_etag()},
        )
        response.assert_status(413)
        assert self.file.read_bytes() == original

    async def test_multibyte_content_size_is_measured_in_bytes(self):
        # 'é' is 2 bytes in UTF-8, so this is under the limit in chars but over it in bytes.
        response = await self.put(
            self.url("app/x.py"),
            json={"content": "é" * (MAX_BYTES // 2 + 1), "etag": self.current_etag()},
        )
        response.assert_status(413)

    async def test_missing_file_returns_404_and_is_not_created(self):
        response = await self.put(
            self.url("app/new.py"), json={"content": "new", "etag": sha256(b"")}
        )
        response.assert_status(404)
        assert not (self.root / "app" / "new.py").exists()

    async def test_directory_returns_404(self):
        response = await self.put(self.url("app"), json={"content": "x", "etag": "abc"})
        response.assert_status(404)
        assert (self.root / "app").is_dir()

    async def test_dot_dot_traversal_returns_400(self):
        etag = self.current_etag(self.secret)
        for path in ["../secret.txt", "app/../../secret.txt"]:
            response = await self.put(self.url(path), json={"content": "pwned", "etag": etag})
            response.assert_status(400)
        assert self.secret.read_text() == "secret"

    async def test_absolute_path_returns_400(self):
        response = await self.put(
            self.url(str(self.secret)),
            json={"content": "pwned", "etag": self.current_etag(self.secret)},
        )
        response.assert_status(400)
        assert self.secret.read_text() == "secret"

    async def test_symlink_escaping_root_returns_400(self):
        link = self.root / "escape.txt"
        os.symlink(self.secret, link)

        response = await self.put(
            self.url("escape.txt"),
            json={"content": "pwned", "etag": self.current_etag(self.secret)},
        )
        response.assert_status(400)
        assert self.secret.read_text() == "secret"
        assert link.is_symlink()

    async def test_unknown_project_returns_404(self):
        response = await self.put(
            self.url("app/x.py", project_id=999999), json={"content": "x", "etag": "abc"}
        )
        response.assert_status(404)

    async def test_failed_replace_keeps_original_and_removes_temp_file(self):
        with mock.patch(
            "app.controllers.project_file_content_controller.os.replace",
            side_effect=PermissionError,
        ):
            response = await self.put(
                self.url("app/x.py"), json={"content": "lost", "etag": self.current_etag()}
            )
        response.assert_status(403)

        assert self.file.read_text() == "print('héllo')\n"
        assert sorted(p.name for p in (self.root / "app").iterdir()) == ["x.py"]

    async def test_lone_surrogate_content_returns_422(self):
        original = self.file.read_bytes()

        response = await self.put(
            self.url("app/x.py"),
            content=b'{"content": "\\ud800", "etag": "%s"}' % self.current_etag().encode(),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        response.assert_status(422)
        assert self.file.read_bytes() == original

    async def test_oversized_existing_file_returns_413_without_hashing_or_locking(self):
        big = self.root / "big.txt"
        with open(big, "wb") as f:
            f.truncate(MAX_BYTES * 50)

        with mock.patch(
            "app.controllers.project_file_content_controller._replace_atomically"
        ) as replace:
            response = await self.put(self.url("big.txt"), json={"content": "x", "etag": "bogus"})
        response.assert_status(413)

        replace.assert_not_called()
        assert big.stat().st_size == MAX_BYTES * 50

    async def test_fifo_returns_404(self):
        os.mkfifo(self.root / "pipe")

        response = await self.put(self.url("pipe"), json={"content": "x", "etag": "abc"})
        response.assert_status(404)

    async def test_missing_etag_returns_422(self):
        response = await self.put(self.url("app/x.py"), json={"content": "x"})
        response.assert_status(422)
        assert self.file.read_text() == "print('héllo')\n"
