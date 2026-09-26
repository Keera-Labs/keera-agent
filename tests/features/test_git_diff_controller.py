"""Feature tests for GET /api/projects/{project_id}/git/diff."""

import os

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.services.git_diff import MAX_SIDE_BYTES
from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase


class TestGitDiffController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = GitTestRepo(self).init()
        self.repo.write("app.py", "print('v1')\n")
        self.repo.write("notes.txt", "old notes\n")
        self.repo.commit_all("initial")
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))

    async def diff(self, path: str, staged: bool = False, **params):
        return await self.get(
            f"/api/projects/{self.project.id}/git/diff",
            params={"path": path, "staged": str(staged).lower(), **params},
        )

    async def test_unstaged_compares_index_with_working_tree(self):
        self.repo.write("app.py", "print('v2')\n")
        self.repo.git("add", "app.py")
        self.repo.write("app.py", "print('v3')\n")

        response = await self.diff("app.py")

        response.assert_ok()
        body = response.json()
        assert body == {
            "path": "app.py",
            "original_path": None,
            "status": "M",
            "staged": False,
            "untracked": False,
            "original": "print('v2')\n",
            "modified": "print('v3')\n",
            "binary": False,
            "too_large": False,
            "language": "python",
        }

    async def test_staged_compares_head_with_index(self):
        self.repo.write("app.py", "print('v2')\n")
        self.repo.git("add", "app.py")
        self.repo.write("app.py", "print('v3')\n")

        body = (await self.diff("app.py", staged=True)).json()

        assert body["original"] == "print('v1')\n"
        assert body["modified"] == "print('v2')\n"
        assert body["staged"] is True

    async def test_untracked_file_has_empty_original(self):
        self.repo.write("dir/new.md", "# new\n")

        body = (await self.diff("dir/new.md")).json()

        assert body["status"] == "U" and body["untracked"] is True
        assert body["original"] is None and body["modified"] == "# new\n"
        assert body["language"] == "markdown"
        status = (await self.get(f"/api/projects/{self.project.id}/git/status")).json()
        entry = next(f for f in status["changes"] if f["path"] == "dir/new.md")
        assert (entry["status"], entry["untracked"]) == (body["status"], body["untracked"])

    async def test_staged_added_file_has_empty_original(self):
        self.repo.write("added.txt", "added\n")
        self.repo.git("add", "added.txt")

        body = (await self.diff("added.txt", staged=True)).json()

        assert body["status"] == "A"
        assert body["original"] is None and body["modified"] == "added\n"

    async def test_deleted_file_has_empty_modified(self):
        (self.repo.root / "notes.txt").unlink()

        unstaged = (await self.diff("notes.txt")).json()
        assert unstaged["status"] == "D"
        assert unstaged["original"] == "old notes\n" and unstaged["modified"] is None

        self.repo.git("rm", "-q", "--cached", "notes.txt")
        staged = (await self.diff("notes.txt", staged=True)).json()
        assert staged["original"] == "old notes\n" and staged["modified"] is None

    async def test_staged_rename_reads_original_from_old_path(self):
        self.repo.git("mv", "notes.txt", "renamed.txt")

        body = (await self.diff("renamed.txt", staged=True)).json()

        assert body["status"] == "R"
        assert body["original_path"] == "notes.txt"
        assert body["original"] == "old notes\n" and body["modified"] == "old notes\n"

    async def test_unmerged_file_compares_head_with_conflict_markers(self):
        self.repo.merge_with_conflicts(
            ours={"notes.txt": "ours\n"}, theirs={"notes.txt": "theirs\n"}
        )

        body = (await self.diff("notes.txt")).json()

        assert body["status"] == "U" and body["untracked"] is False
        assert body["original"] == "ours\n"
        assert "<<<<<<<" in body["modified"] and "theirs" in body["modified"]

    async def test_staged_copy_reads_original_from_source(self):
        self.repo.git("config", "status.renames", "copies")
        self.repo.write("notes-copy.txt", "old notes\n")
        self.repo.write("notes.txt", "old notes\nedited\n")
        self.repo.git("add", "-A")

        body = (await self.diff("notes-copy.txt", staged=True)).json()

        assert body["status"] == "C"
        assert body["original_path"] == "notes.txt"
        assert body["original"] == "old notes\n" and body["modified"] == "old notes\n"

    async def test_binary_file_returns_placeholder_flags(self):
        self.repo.write("logo.png", b"\x89PNG\x00\x01\x02")

        body = (await self.diff("logo.png")).json()

        assert body["binary"] is True and body["too_large"] is False
        assert body["original"] is None and body["modified"] is None

    async def test_too_large_file_returns_placeholder_flags(self):
        self.repo.write("big.txt", "x" * (MAX_SIDE_BYTES + 1))

        body = (await self.diff("big.txt")).json()

        assert body["too_large"] is True
        assert body["original"] is None and body["modified"] is None

    async def test_unchanged_path_is_404(self):
        response = await self.diff("app.py")

        response.assert_status(404)
        assert response.json()["detail"] == "No unstaged changes for app.py"

    async def test_invalid_paths_are_422(self):
        for path in ("../outside.txt", "/etc/passwd", ".", "a/../../b"):
            response = await self.diff(path)
            assert response.status_code == 422, path

        missing = await self.get(f"/api/projects/{self.project.id}/git/diff")
        assert missing.status_code == 422

    async def test_symlink_is_diffed_by_target_text_not_followed(self):
        outside = self.repo.base / "secret.txt"
        outside.write_text("secret\n")
        os.symlink(outside, self.repo.root / "link")

        body = (await self.diff("link")).json()

        assert body["modified"] == str(outside)

    async def test_diff_in_selected_worktree(self):
        path = self.repo.add_worktree(".claude/worktrees/agent-5", "agent-diff")
        (path / "app.py").write_text("print('agent')\n")

        body = (await self.diff("app.py", worktree=str(path))).json()

        assert body["original"] == "print('v1')\n"
        assert body["modified"] == "print('agent')\n"
        main = await self.diff("app.py")
        main.assert_status(404)
