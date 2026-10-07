"""Feature tests for POST /api/projects/{project_id}/git/push (local bare remotes only)."""

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase


class TestGitPushController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = GitTestRepo(self).init()
        self.repo.write("a.txt", "a\n")
        self.head = self.repo.commit_all()
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))

    @property
    def url(self) -> str:
        return f"/api/projects/{self.project.id}/git/push"

    async def test_first_push_sets_upstream(self):
        remote = self.repo.add_bare_remote()
        self.repo.git("checkout", "-q", "-b", "task/feature")

        response = await self.post(self.url, json={})

        response.assert_ok()
        body = response.json()
        assert body["branch"] == "task/feature"
        assert body["upstream"] == "origin/task/feature"
        assert body["status"]["upstream"] == "origin/task/feature"
        assert body["status"]["ahead"] == 0
        pushed = self.repo.git("rev-parse", "refs/heads/task/feature", cwd=remote).strip()
        assert pushed == self.head

    async def test_push_to_existing_upstream(self):
        remote = self.repo.add_bare_remote()
        self.repo.git("push", "-q", "-u", "origin", "main")
        self.repo.write("a.txt", "b\n")
        head = self.repo.commit_all("second")

        response = await self.post(self.url, json={})

        response.assert_ok()
        assert self.repo.git("rev-parse", "refs/heads/main", cwd=remote).strip() == head

    async def test_prefers_origin_but_falls_back_to_another_remote(self):
        remote = self.repo.add_bare_remote("upstream")

        response = await self.post(self.url, json={})

        response.assert_ok()
        assert response.json()["upstream"] == "upstream/main"
        assert self.repo.git("rev-parse", "refs/heads/main", cwd=remote).strip() == self.head

    async def test_no_remote_is_409(self):
        response = await self.post(self.url, json={})

        response.assert_status(409)
        assert response.json()["detail"] == "No git remote configured"

    async def test_detached_head_is_409(self):
        self.repo.add_bare_remote()
        self.repo.git("checkout", "-q", "--detach", self.head)

        response = await self.post(self.url, json={})

        response.assert_status(409)
        assert "detached" in response.json()["detail"]

    async def test_rejected_push_includes_git_stderr(self):
        remote = self.repo.add_bare_remote()
        self.repo.git("push", "-q", "-u", "origin", "main")
        # Advance the remote from a second clone so the local push is non-fast-forward.
        other = self.repo.base / "other"
        self.repo.git("clone", "-q", "-b", "main", str(remote), str(other), cwd=self.repo.base)
        (other / "a.txt").write_text("theirs\n")
        self.repo.git("commit", "-q", "-am", "theirs", cwd=other)
        self.repo.git("push", "-q", cwd=other)
        self.repo.write("a.txt", "ours\n")
        self.repo.commit_all("ours")

        response = await self.post(self.url, json={})

        response.assert_status(409)
        assert "rejected" in response.json()["detail"]
