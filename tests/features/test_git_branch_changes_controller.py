"""Branch comparison uses local refs and committed blobs, never working files."""

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.services.git_diff import MAX_SIDE_BYTES
from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase


class TestGitBranchChangesController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = GitTestRepo(self).init()
        self.repo.write("notes.txt", "base\n")
        self.repo.commit_all("initial")
        self.repo.git("branch", "dev")
        self.repo.git("checkout", "-qb", "task/feature")
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))

    async def comparison(self, **params):
        response = await self.get(
            f"/api/projects/{self.project.id}/git/branch-changes", params=params
        )
        response.assert_ok()
        return response.json()

    async def diff(self, path, **params):
        return await self.get(
            f"/api/projects/{self.project.id}/git/diff",
            params={"path": path, "committed": "true", **params},
        )

    async def test_commit_keeps_files_and_diff_ignores_uncommitted_edits(self):
        self.repo.write("notes.txt", "committed\n")
        self.repo.commit_all("feature")
        self.repo.write("notes.txt", "working\n")
        self.repo.git("add", "notes.txt")
        body = await self.comparison()
        assert body["base"] == "dev" and body["ahead"] == 1
        assert body["files"][0]["path"] == "notes.txt"
        assert body["files"][0]["additions"] == body["files"][0]["deletions"] == 1
        diff = (await self.diff("notes.txt")).json()
        assert diff["original"] == "base\n" and diff["modified"] == "committed\n"
        status = (await self.get(f"/api/projects/{self.project.id}/git/status")).json()
        assert status["staged"][0]["path"] == "notes.txt"

    async def test_diverged_base_uses_merge_base(self):
        self.repo.write("notes.txt", "feature\n")
        self.repo.commit_all()
        self.repo.git("checkout", "-q", "dev")
        self.repo.write("base-only.txt", "base advanced\n")
        self.repo.commit_all()
        self.repo.git("checkout", "-q", "task/feature")
        body = await self.comparison()
        assert body["ahead"] == 1
        assert [f["path"] for f in body["files"]] == ["notes.txt"]

    async def test_base_itself_and_detached_head(self):
        self.repo.git("checkout", "-q", "dev")
        body = await self.comparison()
        assert body["ahead"] == 0 and body["files"] == []
        self.repo.git("checkout", "--detach", "-q")
        self.repo.write("notes.txt", "detached\n")
        self.repo.commit_all()
        body = await self.comparison()
        assert body["base"] == "dev" and body["ahead"] == 1

    async def test_no_dev_falls_back_to_main(self):
        self.repo.git("branch", "-D", "dev")
        assert (await self.comparison())["base"] == "main"

    async def test_remote_default_precedes_main(self):
        self.repo.git("branch", "-D", "dev")
        self.repo.add_bare_remote()
        self.repo.git("branch", "trunk")
        self.repo.git("push", "origin", "trunk")
        self.repo.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk")
        assert (await self.comparison())["base"] == "trunk"
        self.repo.git("branch", "-D", "trunk")
        assert (await self.comparison())["base"] == "origin/trunk"

    async def test_upstream_and_no_base(self):
        self.repo.git("branch", "-D", "dev", "main")
        self.repo.add_bare_remote()
        self.repo.git("push", "-u", "origin", "HEAD:integration")
        assert (await self.comparison())["base"] == "origin/integration"
        self.repo.git("branch", "--unset-upstream")
        body = await self.comparison()
        assert body["base"] is None and body["merge_base"] is None

    async def test_agent_worktree(self):
        path = self.repo.add_worktree(".claude/worktrees/agent-7", "agent-feature")
        (path / "notes.txt").write_text("agent\n")
        self.repo.git("add", "-A", cwd=path)
        self.repo.git("commit", "-qm", "agent", cwd=path)
        body = await self.comparison(worktree=str(path))
        assert body["ahead"] == 1 and body["files"][0]["path"] == "notes.txt"
        assert (await self.comparison())["ahead"] == 0
        assert (await self.diff("notes.txt", worktree=str(path))).json()["modified"] == "agent\n"

    async def test_rename_deletion_binary_large_and_unusual_paths(self):
        self.repo.git("mv", "notes.txt", "renamed.txt")
        self.repo.write("binary.png", b"\x00abc")
        self.repo.write("big.txt", "x" * (MAX_SIDE_BYTES + 1))
        self.repo.write("tab\tname\n.txt", "new\n")
        self.repo.commit_all()
        files = {f["path"]: f for f in (await self.comparison())["files"]}
        assert files["renamed.txt"]["original_path"] == "notes.txt"
        assert files["binary.png"]["binary"] is True
        assert "tab\tname\n.txt" in files
        assert (await self.diff("renamed.txt")).json()["original"] == "base\n"
        assert (await self.diff("binary.png")).json()["binary"] is True
        assert (await self.diff("big.txt")).json()["too_large"] is True
        (self.repo.root / "renamed.txt").unlink()
        self.repo.commit_all()
        assert (await self.diff("notes.txt")).json()["modified"] is None

    async def test_file_type_change_uses_modified_status(self):
        (self.repo.root / "notes.txt").unlink()
        (self.repo.root / "notes.txt").symlink_to("elsewhere.txt")
        self.repo.commit_all()
        body = await self.comparison()
        assert body["files"][0]["status"] == "M"
        diff = (await self.diff("notes.txt")).json()
        assert diff["original"] == "base\n" and diff["modified"] == "elsewhere.txt"

    async def test_unborn_and_unrelated_histories_have_no_comparison(self):
        self.repo.git("checkout", "--orphan", "unrelated")
        self.repo.git("rm", "-rf", ".")
        body = await self.comparison()
        assert body["head"] is None and body["merge_base"] is None
        self.repo.write("unrelated.txt", "new root\n")
        self.repo.commit_all()
        body = await self.comparison()
        assert body["base"] == "dev" and body["merge_base"] is None

    async def test_committed_diff_validates_path_and_membership(self):
        (await self.diff("../outside.txt")).assert_status(422)
        (await self.diff("notes.txt")).assert_status(404)

    async def test_commit_api_refresh_returns_clean_status_but_branch_retains_files(self):
        self.repo.write("notes.txt", "committed\n")
        self.repo.git("add", "notes.txt")
        response = await self.post(
            f"/api/projects/{self.project.id}/git/commits", json={"message": "feature"}
        )
        response.assert_status(201)
        assert response.json()["status"]["count"] == 0
        assert (await self.comparison())["ahead"] == 1

    async def test_push_keeps_branch_changes_with_local_remote(self):
        self.repo.add_bare_remote()
        self.repo.git("push", "-u", "origin", "task/feature")
        self.repo.write("notes.txt", "feature\n")
        self.repo.commit_all()
        response = await self.post(f"/api/projects/{self.project.id}/git/push", json={})
        response.assert_ok()
        assert (await self.comparison())["ahead"] == 1
