"""Feature tests for GET /git/worktrees and the ?worktree= selector on the git endpoints."""

import shutil

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase


class TestGitWorktreeController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = GitTestRepo(self).init()
        self.repo.write("README.md", "hello\n")
        self.repo.commit_all("initial")
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))

    def url(self, action: str) -> str:
        return f"/api/projects/{self.project.id}/git/{action}"

    async def test_non_git_project_lists_no_worktrees(self):
        project = await ProjectFactory.new().create(path=str(self.repo.base))

        response = await self.get(f"/api/projects/{project.id}/git/worktrees")

        response.assert_ok()
        assert response.json() == {"worktrees": []}

    async def test_lists_main_checkout_and_agent_worktrees(self):
        agent = await AgentFactory.new().create(project_id=self.project.id, name="Diff Engineer")
        agent_path = self.repo.add_worktree(f".claude/worktrees/agent-{agent.id}", "agent-work")
        other_path = self.repo.add_worktree("../other", "feature")
        self.repo.git("checkout", "-q", "--detach", cwd=other_path)

        response = await self.get(self.url("worktrees"))

        response.assert_ok()
        rows = {row["path"]: row for row in response.json()["worktrees"]}
        main = rows[str(self.repo.root)]
        assert main["branch"] == "main" and main["is_main"] and main["is_current"]
        assert main["agent_id"] is None and main["agent_name"] is None
        assert len(main["head"]) == 40

        by_agent = rows[str(agent_path)]
        assert by_agent["branch"] == "agent-work"
        assert not by_agent["is_main"] and not by_agent["is_current"]
        assert by_agent["agent_id"] == agent.id
        assert by_agent["agent_name"] == "Diff Engineer"

        detached = rows[str(other_path)]
        assert detached["detached"] is True and detached["branch"] is None
        assert detached["agent_id"] is None

    async def test_unknown_agent_id_keeps_id_without_name(self):
        path = self.repo.add_worktree(".claude/worktrees/agent-999999", "ghost")

        rows = (await self.get(self.url("worktrees"))).json()["worktrees"]

        row = next(r for r in rows if r["path"] == str(path))
        assert row["agent_id"] == 999999 and row["agent_name"] is None

    async def test_endpoints_operate_on_the_selected_worktree(self):
        path = self.repo.add_worktree(".claude/worktrees/agent-1", "agent-branch")
        (path / "new.txt").write_text("from agent\n")
        query = {"worktree": str(path)}

        status = (await self.get(self.url("status"), params=query)).json()
        assert status["branch"] == "agent-branch"
        assert [f["path"] for f in status["changes"]] == ["new.txt"]
        main_status = (await self.get(self.url("status"))).json()
        assert main_status["branch"] == "main"
        assert "new.txt" not in [f["path"] for f in main_status["changes"]]

        staged = await self.post(self.url("stage"), params=query, json={"all": True})
        assert [f["path"] for f in staged.json()["staged"]] == ["new.txt"]

        commit = await self.post(self.url("commits"), params=query, json={"message": "agent"})
        commit.assert_status(201)
        log = (await self.get(self.url("commits"), params=query)).json()["commits"]
        assert log[0]["subject"] == "agent"
        assert (await self.get(self.url("commits"))).json()["commits"][0]["subject"] == "initial"

    async def test_push_uses_the_selected_worktree_branch(self):
        remote = self.repo.add_bare_remote()
        path = self.repo.add_worktree(".claude/worktrees/agent-2", "agent-push")

        response = await self.post(self.url("push"), params={"worktree": str(path)})

        response.assert_ok()
        assert response.json()["branch"] == "agent-push"
        assert "agent-push" in self.repo.git("branch", "--list", cwd=remote)

    async def test_rejects_paths_that_are_not_listed_worktrees(self):
        outside = self.repo.base / "not-a-worktree"
        outside.mkdir()

        for worktree in (str(outside), str(self.repo.root / "sub"), "relative", "/"):
            for method, action in (("get", "status"), ("get", "commits"), ("get", "diff")):
                params = {"worktree": worktree, "path": "README.md"}
                response = await getattr(self, method)(self.url(action), params=params)
                assert response.status_code == 422, (worktree, action)
            response = await self.post(
                self.url("stage"), params={"worktree": worktree}, json={"all": True}
            )
            assert response.status_code == 422
            pull = await self.get(self.url("pull-request"), params={"worktree": worktree})
            assert pull.status_code == 422

    async def test_rejects_prunable_worktree(self):
        path = self.repo.add_worktree(".claude/worktrees/agent-3", "gone")
        shutil.rmtree(path)

        rows = (await self.get(self.url("worktrees"))).json()["worktrees"]
        assert next(r for r in rows if r["path"] == str(path))["prunable"] is True

        response = await self.get(self.url("status"), params={"worktree": str(path)})
        assert response.status_code == 422

    async def test_worktree_on_non_git_project_is_rejected(self):
        project = await ProjectFactory.new().create(path=str(self.repo.base))

        response = await self.get(
            f"/api/projects/{project.id}/git/status", params={"worktree": str(self.repo.root)}
        )

        assert response.status_code == 422
