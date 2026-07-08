"""
Feature tests for agent_controller.adopt_work — POST /api/agents/:id/adopt-work.

Adopting an agent's work removes its worktree, then checks out the worktree
branch (worktree-agent-{id}) in the main repo — leaving the project ON that
branch. It never merges and never deletes the branch.
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
        ["git", *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        check=True,
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
            project_id=self.project.id,
            name="AdoptBot",
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

    def _current_branch(self):
        return subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=self._tmpdir,
            capture_output=True,
            text=True,
        ).stdout.strip()

    async def test_adopt_work_removes_worktree_and_checks_out_branch(self):
        branch, wt_path = self._make_worktree_with_commit()

        response = await self.post(f"/api/agents/{self.agent.id}/adopt-work")
        response.assert_ok().assert_json(lambda j: j.where("ok", True).etc())

        # The main repo is now ON the agent branch.
        self.assertEqual(self._current_branch(), branch)
        # The agent's committed file is present because we checked out its branch.
        self.assertTrue(os.path.exists(os.path.join(self._tmpdir, "feature.txt")))
        # The worktree directory is gone.
        self.assertFalse(os.path.isdir(wt_path))
        # The branch is kept.
        branch_list = subprocess.run(
            ["git", "branch", "--list", branch],
            cwd=self._tmpdir,
            capture_output=True,
            text=True,
        )
        self.assertIn(branch, branch_list.stdout)
        # No merge ever ran.
        self.assertFalse(os.path.exists(os.path.join(self._tmpdir, ".git", "MERGE_HEAD")))

    async def test_adopt_work_preserves_dirty_agent_worktree(self):
        """QA Req5 regression: an agent worktree with uncommitted/untracked
        changes must NOT be destroyed. adopt_work bails with 409 before touching
        anything, keeps the worktree, and leaves the main repo on its branch."""
        branch, wt_path = self._make_worktree_with_commit()
        # Uncommitted tracked edit + a brand-new untracked file in the worktree.
        with open(os.path.join(wt_path, "feature.txt"), "a") as f:
            f.write("uncommitted edit\n")
        with open(os.path.join(wt_path, "scratch.txt"), "w") as f:
            f.write("untracked work\n")

        before_branch = self._current_branch()
        response = await self.post(f"/api/agents/{self.agent.id}/adopt-work")
        response.assert_status(409).assert_json(
            lambda j: j.where("error", lambda v: "worktree" in v.lower()).etc()
        )

        # Worktree still exists with both uncommitted items intact.
        self.assertTrue(os.path.isdir(wt_path))
        with open(os.path.join(wt_path, "feature.txt")) as f:
            self.assertIn("uncommitted edit", f.read())
        self.assertTrue(os.path.exists(os.path.join(wt_path, "scratch.txt")))
        # Nothing changed in main — no checkout happened.
        self.assertEqual(self._current_branch(), before_branch)
        self.assertFalse(os.path.exists(os.path.join(self._tmpdir, "feature.txt")))

    async def test_adopt_work_returns_409_dirty_main_working_tree(self):
        """A dirty main working tree blocks the checkout, so adopt_work bails
        with 409 BEFORE removing the worktree — the worktree survives and no
        checkout happens."""
        branch, wt_path = self._make_worktree_with_commit()
        # Uncommitted local change in the main repo.
        with open(os.path.join(self._tmpdir, "README.md"), "w") as f:
            f.write("uncommitted local edit\n")

        before_branch = self._current_branch()
        response = await self.post(f"/api/agents/{self.agent.id}/adopt-work")
        response.assert_status(409).assert_json(
            lambda j: j.where(
                "error", lambda v: "uncommitted" in v.lower() or "stash" in v.lower()
            ).etc()
        )

        # The worktree was NOT removed and the main repo did not switch branches.
        self.assertTrue(os.path.isdir(wt_path))
        self.assertEqual(self._current_branch(), before_branch)
        with open(os.path.join(self._tmpdir, "README.md")) as f:
            self.assertEqual(f.read(), "uncommitted local edit\n")
