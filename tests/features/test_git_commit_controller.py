"""Feature tests for GET/POST /api/projects/{project_id}/git/commits."""

from unittest import mock

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase


class TestGitCommitController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = GitTestRepo(self).init()
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))

    @property
    def url(self) -> str:
        return f"/api/projects/{self.project.id}/git/commits"

    async def test_commit_staged_changes(self):
        self.repo.write("a.txt", "a\n")
        self.repo.write("b.txt", "b\n")
        self.repo.git("add", "a.txt")

        response = await self.post(self.url, json={"message": "  Add a\n\nDetails here  "})

        response.assert_status(201)
        body = response.json()
        assert body["sha"] == self.repo.git("rev-parse", "HEAD").strip()
        assert body["short_sha"] and body["sha"].startswith(body["short_sha"])
        assert body["subject"] == "Add a"
        assert body["status"]["staged"] == []
        assert [f["path"] for f in body["status"]["changes"]] == ["b.txt"]
        assert self.repo.git("log", "-1", "--format=%B").strip() == "Add a\n\nDetails here"

    async def test_blank_message_is_422(self):
        self.repo.write("a.txt", "a\n")
        self.repo.git("add", "a.txt")

        response = await self.post(self.url, json={"message": "   "})

        response.assert_status(422)

    async def test_nothing_staged_is_409(self):
        self.repo.write("a.txt", "a\n")

        response = await self.post(self.url, json={"message": "Nothing"})

        response.assert_status(409)
        assert response.json()["detail"] == "Nothing staged to commit"

    async def test_failing_hook_returns_its_output(self):
        self.repo.write("a.txt", "a\n")
        self.repo.git("add", "a.txt")
        hook = self.repo.root / ".git" / "hooks" / "pre-commit"
        hook.write_text("#!/bin/sh\necho 'lint failed: a.txt' >&2\nexit 1\n")
        hook.chmod(0o755)

        response = await self.post(self.url, json={"message": "Blocked"})

        response.assert_status(409)
        assert "lint failed: a.txt" in response.json()["detail"]

    async def test_hanging_hook_is_killed_after_timeout(self):
        self.repo.write("a.txt", "a\n")
        self.repo.git("add", "a.txt")
        hook = self.repo.root / ".git" / "hooks" / "pre-commit"
        hook.write_text("#!/bin/sh\nsleep 30\n")
        hook.chmod(0o755)

        with mock.patch("app.services.git_repository.WRITE_TIMEOUT", 1):
            response = await self.post(self.url, json={"message": "Hangs"})

        response.assert_status(409)
        assert "timed out" in response.json()["detail"]

    async def test_index_lists_recent_commits_newest_first(self):
        for i in range(3):
            self.repo.write("a.txt", f"{i}\n")
            self.repo.commit_all(f"Commit {i}")

        response = await self.get(f"{self.url}?limit=2")

        response.assert_ok()
        commits = response.json()["commits"]
        assert [c["subject"] for c in commits] == ["Commit 2", "Commit 1"]
        assert commits[0]["author"] == "Test"
        assert commits[0]["sha"] == self.repo.git("rev-parse", "HEAD").strip()
        assert "T" in commits[0]["date"]

    async def test_index_on_repo_without_commits_is_empty(self):
        response = await self.get(self.url)

        response.assert_ok()
        assert response.json() == {"commits": []}

    async def test_index_rejects_out_of_range_limit(self):
        response = await self.get(f"{self.url}?limit=0", headers={"Accept": "application/json"})
        response.assert_status(422)
