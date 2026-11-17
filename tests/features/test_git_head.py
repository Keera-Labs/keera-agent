import unittest
from types import SimpleNamespace
from unittest import mock

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.controllers.agent_trigger_controller import ensure_agent_worktree
from app.mcp.tools import SpawnAgentTool
from app.services.git_head import agent_worktree_available, repo_has_commit
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase


def _agent(provider="claude", use_worktree=True):
    return SimpleNamespace(id=9, provider=provider, use_worktree=use_worktree)


class TestRepoHasCommit(unittest.TestCase):
    def setUp(self):
        self.repo = GitTestRepo(self)
        self.cwd = str(self.repo.root)

    def test_directory_without_a_repository(self):
        self.assertFalse(repo_has_commit(self.cwd))

    def test_repository_with_an_unborn_head(self):
        self.repo.init()

        self.assertFalse(repo_has_commit(self.cwd))

    def test_repository_with_a_commit(self):
        self.repo.init()
        self.repo.write("README.md", "hello\n")
        self.repo.commit_all("initial")

        self.assertTrue(repo_has_commit(self.cwd))

    def test_detached_head_and_subdirectory_count_as_having_a_commit(self):
        self.repo.init()
        self.repo.write("src/app.py", "x = 1\n")
        sha = self.repo.commit_all("initial")
        self.repo.git("checkout", "-q", "--detach", sha)

        self.assertTrue(repo_has_commit(self.cwd))
        self.assertTrue(repo_has_commit(str(self.repo.root / "src")))

    def test_missing_directory(self):
        self.assertFalse(repo_has_commit(str(self.repo.root / "missing")))


class TestAgentWorktreeAvailable(unittest.TestCase):
    def setUp(self):
        self.repo = GitTestRepo(self).init()
        self.cwd = str(self.repo.root)

    def test_unborn_head_falls_back_with_a_warning(self):
        with mock.patch("app.services.git_head.Log") as logger:
            self.assertFalse(agent_worktree_available(_agent(), self.cwd))

        logger.warning.assert_called_once()

    def test_repository_with_a_commit_uses_the_worktree(self):
        self.repo.write("README.md", "hello\n")
        self.repo.commit_all("initial")

        self.assertTrue(agent_worktree_available(_agent(), self.cwd))

    def test_agent_without_worktree_is_never_isolated(self):
        self.repo.write("README.md", "hello\n")
        self.repo.commit_all("initial")

        self.assertFalse(agent_worktree_available(_agent(use_worktree=False), self.cwd))


class TestEnsureAgentWorktreeWithoutCommit(unittest.TestCase):
    def test_codex_agent_runs_in_the_project_directory_of_an_unborn_repository(self):
        repo = GitTestRepo(self).init()
        repo.write(".env", "SECRET=1\n")

        cwd = ensure_agent_worktree(_agent(provider="codex"), str(repo.root), [".env"])

        self.assertEqual(cwd, str(repo.root))
        self.assertFalse((repo.root / ".claude/worktrees").exists())

    def test_claude_agent_outside_a_repository_runs_in_the_project_directory(self):
        repo = GitTestRepo(self)

        self.assertEqual(ensure_agent_worktree(_agent(), str(repo.root), [".env"]), str(repo.root))


class TestAgentCommandWorktreeFlag(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.agent = await AgentFactory.new().create(
            project_id=self.project.id, provider="claude", use_worktree=True
        )

    async def test_repository_with_a_commit_keeps_the_worktree_flag(self):
        self.assertIn(f"--worktree agent-{self.agent.id}", self.agent.to_command())

    async def test_project_without_a_commit_drops_the_worktree_flag(self):
        self.assertNotIn("--worktree", self.agent.to_command(in_worktree=False))


class TestSpawnAgentWorkspaceNote(TestCase, DatabaseTransaction):
    async def _spawn_into(self, repo: GitTestRepo) -> str:
        project = await ProjectFactory.new().create(path=str(repo.root))
        response = await SpawnAgentTool().handle(
            {
                "project_path": project.path,
                "name": "Engineer",
                "agent_type": "software_engineer",
                "complexity": "medium",
            }
        )
        return response.to_content()[0]["text"]

    async def test_unborn_repository_reports_the_shared_workspace(self):
        text = await self._spawn_into(GitTestRepo(self).init())

        self.assertIn("instead of an isolated worktree", text)

    async def test_repository_with_a_commit_has_no_note(self):
        repo = GitTestRepo(self).init()
        repo.write("README.md", "hello\n")
        repo.commit_all("initial")

        self.assertNotIn("isolated worktree", await self._spawn_into(repo))
