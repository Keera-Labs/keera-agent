"""Feature tests for GET /git/worktrees and the ?worktree= selector on the git endpoints."""

import os
import shutil
from types import SimpleNamespace
from unittest import mock

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Agent import Agent
from app.terminal import cli_supervisor
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

    def worktree_paths(self) -> list[str]:
        listing = self.repo.git("worktree", "list", "--porcelain")
        return [
            line.removeprefix("worktree ")
            for line in listing.splitlines()
            if line.startswith("worktree ")
        ]

    async def destroy(self, path, **params):
        return await self.delete(self.url("worktrees"), params={"worktree": str(path), **params})

    async def test_destroy_removes_a_clean_worktree_and_keeps_its_branch(self):
        path = self.repo.add_worktree("../clean", "clean-work")

        (await self.destroy(path)).assert_no_content()

        assert str(path) not in self.worktree_paths()
        assert not path.exists()
        assert "clean-work" in self.repo.git("branch", "--list", "clean-work")

    async def test_destroy_refuses_uncommitted_changes_without_force(self):
        path = self.repo.add_worktree("../dirty", "dirty-work")
        (path / "a.txt").write_text("a\n")
        (path / "b.txt").write_text("b\n")

        response = await self.destroy(path)

        response.assert_status(409)
        assert response.json()["error"] == "The worktree has 2 uncommitted files that would be lost"
        assert path.exists()

    async def test_destroy_with_force_discards_uncommitted_changes(self):
        path = self.repo.add_worktree("../forced", "forced-work")
        (path / "a.txt").write_text("a\n")

        (await self.destroy(path, force=True)).assert_no_content()

        assert not path.exists()

    async def test_destroy_refuses_the_main_worktree(self):
        response = await self.destroy(self.repo.root, force=True)

        response.assert_status(422)
        assert response.json()["error"] == "The main worktree cannot be removed"
        assert self.repo.root.exists()

    async def test_destroy_rejects_unknown_paths(self):
        response = await self.destroy(self.repo.base / "nowhere")

        response.assert_status(422)
        assert "error" in response.json()

    async def test_destroy_refuses_a_worktree_locked_by_a_running_session(self):
        path = self.repo.add_worktree("../locked", "locked-work")
        self.repo.git(
            "worktree", "lock", "--reason", f"claude session (pid {os.getpid()} start)", str(path)
        )

        response = await self.destroy(path, force=True)

        response.assert_status(409)
        assert path.exists()

    async def test_destroy_releases_a_lock_left_by_an_exited_session(self):
        path = self.repo.add_worktree("../stale", "stale-work")
        self.repo.git(
            "worktree", "lock", "--reason", "claude session (pid 999999999 start)", str(path)
        )

        (await self.destroy(path)).assert_no_content()

        assert not path.exists()

    async def test_destroy_keeps_the_agent_record(self):
        agent = await AgentFactory.new().create(project_id=self.project.id, name="Gone Engineer")
        path = self.repo.add_worktree(f".claude/worktrees/agent-{agent.id}", "agent-gone")

        (await self.destroy(path)).assert_no_content()

        assert await Agent.find(agent.id) is not None
        assert str(path) not in self.worktree_paths()

    def run_agent(self, agent_id: int, alive: bool = True):
        terminal = SimpleNamespace(is_alive=lambda: alive)
        supervisor = SimpleNamespace(agent_id=agent_id, terminal=terminal)
        patcher = mock.patch.dict(cli_supervisor._supervisors, {f"agent-{agent_id}": supervisor})
        patcher.start()
        self.addCleanup(patcher.stop)

    async def test_destroy_refuses_the_unlocked_worktree_of_a_running_agent(self):
        agent = await AgentFactory.new().create(project_id=self.project.id, provider="codex")
        path = self.repo.add_worktree(f".claude/worktrees/agent-{agent.id}", "codex-work")
        self.run_agent(agent.id)

        response = await self.destroy(path, force=True)

        response.assert_status(409)
        assert response.json()["error"] == "The worktree belongs to a running agent"
        assert path.exists()

    async def test_destroy_removes_the_worktree_of_an_agent_whose_session_ended(self):
        agent = await AgentFactory.new().create(project_id=self.project.id)
        path = self.repo.add_worktree(f".claude/worktrees/agent-{agent.id}", "ended-work")
        self.run_agent(agent.id, alive=False)

        (await self.destroy(path)).assert_no_content()

        assert not path.exists()

    async def test_destroy_rejects_paths_that_cannot_be_resolved(self):
        response = await self.destroy("\x00")

        response.assert_status(422)
        assert "error" in response.json()

    async def test_rejects_prunable_worktree(self):
        path = self.repo.add_worktree(".claude/worktrees/agent-3", "gone")
        shutil.rmtree(path)

        rows = (await self.get(self.url("worktrees"))).json()["worktrees"]
        assert next(r for r in rows if r["path"] == str(path))["prunable"] is True

        response = await self.get(self.url("status"), params={"worktree": str(path)})
        assert response.status_code == 422

    async def test_change_counts_cover_every_live_worktree(self):
        self.repo.write("README.md", "edited\n")
        self.repo.write("staged.txt", "new\n")
        self.repo.git("add", "staged.txt")
        self.repo.write("staged.txt", "new and edited\n")
        agent_path = self.repo.add_worktree("../agent-9", "agent-work")
        (agent_path / "a.txt").write_text("a\n")
        (agent_path / "nested").mkdir()
        (agent_path / "nested" / "b.txt").write_text("b\n")
        clean_path = self.repo.add_worktree("../clean", "clean")
        gone_path = self.repo.add_worktree("../gone", "gone")
        shutil.rmtree(gone_path)

        response = await self.get(self.url("worktrees/changes"))

        response.assert_ok()
        assert response.json() == {
            "changes": {str(self.repo.root): 2, str(agent_path): 2, str(clean_path): 0}
        }

    async def test_change_counts_on_non_git_project_are_empty(self):
        project = await ProjectFactory.new().create(path=str(self.repo.base))

        response = await self.get(f"/api/projects/{project.id}/git/worktrees/changes")

        response.assert_ok()
        assert response.json() == {"changes": {}}

    async def test_worktree_on_non_git_project_is_rejected(self):
        project = await ProjectFactory.new().create(path=str(self.repo.base))

        response = await self.get(
            f"/api/projects/{project.id}/git/status", params={"worktree": str(self.repo.root)}
        )

        assert response.status_code == 422
