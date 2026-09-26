"""Feature tests for POST /api/projects/{project_id}/git/stage and /git/unstage."""

import os

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase


def paths(files: list[dict]) -> set[str]:
    return {f["path"] for f in files}


class TestGitStageController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = GitTestRepo(self).init()
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))

    def url(self, action: str) -> str:
        return f"/api/projects/{self.project.id}/git/{action}"

    async def test_stage_selected_paths_returns_status(self):
        self.repo.write("a.txt", "a\n")
        self.repo.write("dir/b.txt", "b\n")

        response = await self.post(self.url("stage"), json={"paths": ["dir/b.txt"]})

        response.assert_ok()
        body = response.json()
        assert paths(body["staged"]) == {"dir/b.txt"}
        assert paths(body["changes"]) == {"a.txt"}

    async def test_stage_all_includes_deletions(self):
        self.repo.write("keep.txt", "k\n")
        self.repo.write("drop.txt", "d\n")
        self.repo.commit_all()
        (self.repo.root / "drop.txt").unlink()
        self.repo.write("keep.txt", "changed\n")

        body = (await self.post(self.url("stage"), json={"all": True})).json()

        staged = {f["path"]: f["status"] for f in body["staged"]}
        assert staged == {"drop.txt": "D", "keep.txt": "M"}
        assert body["changes"] == []

    async def test_stage_treats_paths_literally(self):
        self.repo.write("a*.txt", "star\n")
        self.repo.write("ab.txt", "plain\n")

        body = (await self.post(self.url("stage"), json={"paths": ["a*.txt"]})).json()

        assert paths(body["staged"]) == {"a*.txt"}

    async def test_rejects_paths_escaping_the_repo(self):
        outside = self.repo.base / "outside"
        outside.mkdir()
        os.symlink(outside, self.repo.root / "link")

        for bad in ["../outside", "/etc/passwd", "link/secret.txt", "a/../../x"]:
            response = await self.post(self.url("stage"), json={"paths": [bad]})
            response.assert_status(422)
            assert response.json()["detail"] == f"Invalid path: {bad}"

    async def test_requires_paths_or_all(self):
        response = await self.post(self.url("stage"), json={})
        response.assert_status(422)

    async def test_stage_on_non_git_project_is_409(self):
        project = await ProjectFactory.new().create(path=str(self.repo.base))

        response = await self.post(f"/api/projects/{project.id}/git/stage", json={"all": True})

        response.assert_status(409)
        assert response.json()["detail"] == "Not a git repository"

    async def test_unstage_selected_paths_with_commits(self):
        self.repo.write("a.txt", "a\n")
        self.repo.commit_all()
        self.repo.write("a.txt", "a2\n")
        self.repo.write("b.txt", "b\n")
        self.repo.git("add", "-A")

        body = (await self.post(self.url("unstage"), json={"paths": ["a.txt"]})).json()

        assert paths(body["staged"]) == {"b.txt"}
        assert paths(body["changes"]) == {"a.txt"}

    async def test_unstage_all_on_repo_without_commits(self):
        self.repo.write("a.txt", "a\n")
        self.repo.write("b.txt", "b\n")
        self.repo.git("add", "-A")

        body = (await self.post(self.url("unstage"), json={"all": True})).json()

        assert body["staged"] == []
        assert paths(body["changes"]) == {"a.txt", "b.txt"}
        assert (self.repo.root / "a.txt").exists()
