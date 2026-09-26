"""Feature tests for GET /api/projects/{project_id}/git/status."""

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase


def by_path(files: list[dict]) -> dict[str, dict]:
    return {f["path"]: f for f in files}


class TestGitStatusController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = GitTestRepo(self)
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))

    @property
    def url(self) -> str:
        return f"/api/projects/{self.project.id}/git/status"

    async def test_non_git_project_reports_is_repo_false(self):
        response = await self.get(self.url)

        response.assert_ok()
        body = response.json()
        assert body["is_repo"] is False
        assert body["staged"] == [] and body["changes"] == []
        assert body["count"] == 0

    async def test_missing_project_directory_reports_is_repo_false(self):
        project = await ProjectFactory.new().create(path=str(self.repo.base / "gone"))

        response = await self.get(f"/api/projects/{project.id}/git/status")

        response.assert_ok()
        assert response.json()["is_repo"] is False

    async def test_unknown_project_is_404(self):
        response = await self.get("/api/projects/999999/git/status")
        response.assert_status(404)

    async def test_repo_without_commits_lists_untracked_files_with_line_counts(self):
        self.repo.init()
        self.repo.write("src/app/main.py", "a\nb\nc")

        body = (await self.get(self.url)).json()

        assert body["is_repo"] is True
        assert body["has_commits"] is False
        assert body["head"] is None
        assert body["branch"] == "main"
        assert body["count"] == 1
        assert body["changes"] == [
            {
                "path": "src/app/main.py",
                "name": "main.py",
                "dir": "src/app",
                "status": "U",
                "original_path": None,
                "additions": 3,
                "deletions": 0,
                "binary": False,
                "untracked": True,
            }
        ]

    async def test_staged_and_unstaged_changes_carry_numstat_counts(self):
        self.repo.init()
        self.repo.write("a.txt", "one\ntwo\n")
        self.repo.write("gone.txt", "bye\n")
        head = self.repo.commit_all()

        self.repo.write("a.txt", "one\nTWO\nthree\n")
        self.repo.git("add", "a.txt")
        self.repo.write("a.txt", "one\nTWO\nthree\nfour\n")
        (self.repo.root / "gone.txt").unlink()
        self.repo.write("new.txt", "fresh\n")
        self.repo.git("add", "new.txt")

        body = (await self.get(self.url)).json()

        assert body["head"] == head
        assert body["has_commits"] is True
        staged, changes = by_path(body["staged"]), by_path(body["changes"])
        assert staged["a.txt"]["status"] == "M"
        assert (staged["a.txt"]["additions"], staged["a.txt"]["deletions"]) == (2, 1)
        assert staged["new.txt"]["status"] == "A"
        assert changes["a.txt"]["status"] == "M"
        assert (changes["a.txt"]["additions"], changes["a.txt"]["deletions"]) == (1, 0)
        assert changes["gone.txt"]["status"] == "D"
        assert changes["gone.txt"]["deletions"] == 1
        # a.txt is in both lists but counts once toward the badge.
        assert body["count"] == 3

    async def test_renames_and_binary_files(self):
        self.repo.init()
        self.repo.write("old/name.txt", "keep\nthese\nlines\n")
        self.repo.write("logo.png", b"\x89PNG\x00\x01")
        self.repo.commit_all()

        (self.repo.root / "new").mkdir()
        self.repo.git("mv", "old/name.txt", "new/name.txt")
        self.repo.write("logo.png", b"\x89PNG\x00\x02")
        self.repo.write("blob.bin", b"\x00\x01\x02")

        body = (await self.get(self.url)).json()

        renamed = by_path(body["staged"])["new/name.txt"]
        assert renamed["status"] == "R"
        assert renamed["original_path"] == "old/name.txt"
        changes = by_path(body["changes"])
        assert changes["logo.png"]["binary"] is True
        assert changes["logo.png"]["additions"] is None
        assert changes["blob.bin"]["binary"] is True
        assert changes["blob.bin"]["untracked"] is True

    async def test_detached_head(self):
        self.repo.init()
        self.repo.write("a.txt", "1\n")
        head = self.repo.commit_all()
        self.repo.git("checkout", "-q", "--detach", head)

        body = (await self.get(self.url)).json()

        assert body["detached"] is True
        assert body["branch"] is None
        assert body["head"] == head

    async def test_upstream_ahead_and_behind(self):
        self.repo.init()
        self.repo.add_bare_remote()
        self.repo.write("a.txt", "1\n")
        self.repo.commit_all()
        self.repo.git("push", "-q", "-u", "origin", "main")
        self.repo.write("a.txt", "2\n")
        self.repo.commit_all("ahead one")

        body = (await self.get(self.url)).json()

        assert body["upstream"] == "origin/main"
        assert (body["ahead"], body["behind"]) == (1, 0)

    async def test_status_covers_whole_repo_when_project_is_a_subdirectory(self):
        self.repo.init()
        self.repo.write("pkg/inner.txt", "x\n")
        self.repo.write("top.txt", "y\n")
        project = await ProjectFactory.new().create(path=str(self.repo.root / "pkg"))

        body = (await self.get(f"/api/projects/{project.id}/git/status")).json()

        assert {f["path"] for f in body["changes"]} == {"pkg/inner.txt", "top.txt"}
