"""
Feature tests for agent_controller.adopt_work — POST /api/agents/:id/adopt-work.

Adopting an agent's work merges its worktree branch (worktree-agent-{id}) into
the project's current branch, then removes the worktree directory while keeping
the branch.
"""
import os
import subprocess
import tempfile

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.controllers.agent_trigger_controller import discover_worktree_path
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


def _git(cwd, *args):
    """Run a git command in cwd with deterministic identity, asserting success."""
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "Test",
        "GIT_AUTHOR_EMAIL": "test@example.com",
        "GIT_COMMITTER_NAME": "Test",
        "GIT_COMMITTER_EMAIL": "test@example.com",
    }
    return subprocess.run(
        ["git", *args], cwd=cwd, env=env, capture_output=True, text=True, check=True,
    )


class TestAdoptWork(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._tmpdir = tempfile.mkdtemp()
        # Initialize a git repo with one commit on the main branch.
        _git(self._tmpdir, "init", "-b", "main")
        with open(os.path.join(self._tmpdir, "README.md"), "w") as f:
            f.write("root\n")
        _git(self._tmpdir, "add", ".")
        _git(self._tmpdir, "commit", "-m", "initial")

        self.project = await ProjectFactory.new().create(path=self._tmpdir)
        self.agent = await AgentFactory.new().create(
            project_id=self.project.id, name="AdoptBot",
        )

    def _make_worktree_with_commit(self, filename="feature.txt"):
        """Create the agent worktree/branch and commit a file inside it."""
        branch = f"worktree-agent-{self.agent.id}"
        wt_path = os.path.join(self._tmpdir, ".claude", "worktrees", f"agent-{self.agent.id}")
        _git(self._tmpdir, "worktree", "add", "-b", branch, wt_path)
        with open(os.path.join(wt_path, filename), "w") as f:
            f.write("agent work\n")
        _git(wt_path, "add", ".")
        _git(wt_path, "commit", "-m", "agent feature")
        return branch, wt_path

    # ── discovery helper ──────────────────────────────────────────────────────

    def test_discover_worktree_path_finds_branch(self):
        branch, wt_path = self._make_worktree_with_commit()
        found = discover_worktree_path(self._tmpdir, branch)
        self.assertEqual(os.path.realpath(found), os.path.realpath(wt_path))

    def test_discover_worktree_path_returns_none_when_absent(self):
        self.assertIsNone(discover_worktree_path(self._tmpdir, "worktree-agent-does-not-exist"))

    # ── POST /api/agents/:id/adopt-work ───────────────────────────────────────

    async def test_adopt_work_returns_404_for_missing_agent(self):
        response = await self.post("/api/agents/999999/adopt-work")
        response.assert_status(404)

    async def test_adopt_work_returns_404_without_worktree(self):
        response = await self.post(f"/api/agents/{self.agent.id}/adopt-work")
        response.assert_status(404)

    async def test_adopt_work_merges_branch_and_removes_worktree(self):
        branch, wt_path = self._make_worktree_with_commit()

        response = await self.post(f"/api/agents/{self.agent.id}/adopt-work")
        response.assert_ok().assert_json(lambda j: j.where("ok", True).etc())

        # The agent's file is now merged into the main repo.
        self.assertTrue(os.path.exists(os.path.join(self._tmpdir, "feature.txt")))
        # The worktree directory is gone.
        self.assertFalse(os.path.isdir(wt_path))
        # The branch is kept.
        branch_list = subprocess.run(
            ["git", "branch", "--list", branch],
            cwd=self._tmpdir, capture_output=True, text=True,
        )
        self.assertIn(branch, branch_list.stdout)

    async def test_adopt_work_returns_409_on_merge_conflict(self):
        branch, _ = self._make_worktree_with_commit(filename="README.md")
        # Diverge the main branch so the README change conflicts.
        with open(os.path.join(self._tmpdir, "README.md"), "w") as f:
            f.write("conflicting main change\n")
        _git(self._tmpdir, "commit", "-am", "diverge main")

        response = await self.post(f"/api/agents/{self.agent.id}/adopt-work")
        response.assert_status(409).assert_json(
            lambda j: j.where("error", lambda v: "conflict" in v.lower()).etc()
        )

        # The failed merge was aborted — no merge is left in progress and no
        # tracked file is stuck in a conflicted (unmerged) state.
        self.assertFalse(os.path.exists(os.path.join(self._tmpdir, ".git", "MERGE_HEAD")))
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=self._tmpdir, capture_output=True, text=True,
        )
        unmerged = [ln for ln in status.stdout.splitlines() if ln[:2].strip() in {"U", "AA", "DD", "UU", "AU", "UA", "DU", "UD"}]
        self.assertEqual(unmerged, [])

    async def test_adopt_work_returns_409_dirty_working_tree(self):
        """A dirty main working tree that would be overwritten yields a distinct
        dirty-tree message (not a conflict message), with no merge in progress."""
        self._make_worktree_with_commit(filename="README.md")
        # Uncommitted local change to a file the merge would touch.
        with open(os.path.join(self._tmpdir, "README.md"), "w") as f:
            f.write("uncommitted local edit\n")

        response = await self.post(f"/api/agents/{self.agent.id}/adopt-work")
        response.assert_status(409).assert_json(
            lambda j: j.where("error", lambda v: "uncommitted" in v.lower() or "stash" in v.lower()).etc()
        )

        # No merge was ever started, so nothing was aborted and the local edit survives.
        self.assertFalse(os.path.exists(os.path.join(self._tmpdir, ".git", "MERGE_HEAD")))
        with open(os.path.join(self._tmpdir, "README.md")) as f:
            self.assertEqual(f.read(), "uncommitted local edit\n")
