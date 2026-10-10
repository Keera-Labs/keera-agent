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

    async def test_selected_base_compares_against_its_merge_base(self):
        self.repo.write("notes.txt", "feature\n")
        self.repo.commit_all()
        self.repo.git("checkout", "-qb", "release", "main")
        self.repo.write("release.txt", "release only\n")
        self.repo.commit_all()
        self.repo.git("checkout", "-q", "task/feature")
        self.repo.add_bare_remote()
        self.repo.git("push", "-q", "origin", "release")
        self.repo.git("branch", "-D", "release")

        assert (await self.comparison())["base"] == "dev"
        body = await self.comparison(base="origin/release")
        assert body["base"] == "origin/release" and body["ahead"] == 1
        assert [f["path"] for f in body["files"]] == ["notes.txt"]
        diff = (await self.diff("notes.txt", base="origin/release")).json()
        assert diff["original"] == "base\n" and diff["modified"] == "feature\n"

    async def test_current_branch_as_base_has_no_changes(self):
        self.repo.write("notes.txt", "feature\n")
        self.repo.commit_all()
        body = await self.comparison(base="task/feature")
        assert body["ahead"] == 0 and body["files"] == []

    async def test_detached_head_compares_against_selected_base(self):
        self.repo.git("checkout", "-qb", "release", "main")
        self.repo.write("release.txt", "release only\n")
        self.repo.commit_all()
        self.repo.git("checkout", "-q", "--detach", "task/feature")
        self.repo.write("notes.txt", "detached\n")
        self.repo.commit_all()

        body = await self.comparison(base="release")

        assert body["base"] == "release" and body["ahead"] == 1
        assert [f["path"] for f in body["files"]] == ["notes.txt"]
        diff = (await self.diff("notes.txt", base="release")).json()
        assert diff["original"] == "base\n" and diff["modified"] == "detached\n"

    async def test_local_branch_shadows_same_named_remote(self):
        self.repo.add_bare_remote()
        self.repo.git("push", "-q", "origin", "dev")
        self.repo.git("checkout", "-q", "dev")
        self.repo.write("dev-local.txt", "local only\n")
        self.repo.commit_all()
        self.repo.git("checkout", "-q", "task/feature")
        self.repo.git("merge", "-q", "dev")
        self.repo.write("notes.txt", "feature\n")
        self.repo.commit_all()

        local = await self.comparison(base="dev")
        assert local["base"] == "dev" and local["ahead"] == 1
        assert [f["path"] for f in local["files"]] == ["notes.txt"]

        remote = await self.comparison(base="origin/dev")
        assert remote["base"] == "origin/dev" and remote["ahead"] == 2
        assert sorted(f["path"] for f in remote["files"]) == ["dev-local.txt", "notes.txt"]

    async def test_unknown_or_malformed_base_is_rejected(self):
        response = await self.get(
            f"/api/projects/{self.project.id}/git/branch-changes", params={"base": "nope"}
        )
        response.assert_status(422)
        assert response.json()["detail"] == "Unknown base branch: nope"
        for bad in ("--output=x", "../dev", "dev/../main"):
            response = await self.get(
                f"/api/projects/{self.project.id}/git/branch-changes",
                params={"base": bad},
                headers={"Accept": "application/json"},
            )
            response.assert_status(422)
        (await self.diff("notes.txt", base="nope")).assert_status(422)

    async def test_branches_lists_local_and_remote_branches_with_default(self):
        self.repo.add_bare_remote()
        self.repo.git("push", "-q", "origin", "main")
        self.repo.git("remote", "set-head", "origin", "main")
        response = await self.get(f"/api/projects/{self.project.id}/git/branches")
        response.assert_ok()
        body = response.json()
        assert body["branches"] == ["dev", "main", "task/feature", "origin/main"]
        assert body["default_base"] == "dev"

    async def test_branches_in_agent_worktree_and_without_base(self):
        path = self.repo.add_worktree(".claude/worktrees/agent-7", "agent-feature")
        self.repo.git("branch", "-D", "dev", "main")
        response = await self.get(
            f"/api/projects/{self.project.id}/git/branches", params={"worktree": str(path)}
        )
        response.assert_ok()
        assert response.json() == {
            "branches": ["agent-feature", "task/feature"],
            "default_base": None,
        }

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

    async def test_file_replaced_by_directory_opens_deleted_file(self):
        (self.repo.root / "notes.txt").unlink()
        self.repo.write("notes.txt/child.txt", "child\n")
        self.repo.commit_all()
        response = await self.diff("notes.txt")
        response.assert_ok()
        diff = response.json()
        assert diff["status"] == "D"
        assert diff["original"] == "base\n" and diff["modified"] is None
        assert (await self.diff("notes.txt/child.txt")).json()["modified"] == "child\n"

    async def test_directory_replaced_by_file_opens_added_file(self):
        self.repo.git("checkout", "-q", "dev")
        self.repo.write("node/child.txt", "child\n")
        self.repo.commit_all()
        self.repo.git("checkout", "-q", "task/feature")
        self.repo.git("reset", "-q", "--hard", "dev")
        self.repo.git("rm", "-rq", "node")
        self.repo.write("node", "file\n")
        self.repo.commit_all()
        response = await self.diff("node")
        response.assert_ok()
        diff = response.json()
        assert diff["status"] == "A"
        assert diff["original"] is None and diff["modified"] == "file\n"
        assert (await self.diff("node/child.txt")).json()["original"] == "child\n"
